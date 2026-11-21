import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import {
  buildObjectKey,
  encodeObjectKeyPath,
  extractObjectKeyFromUrl,
  r2Request,
  type R2Config,
} from './r2Signing';

const PORT = Number(process.env.PORT) || 3000;

const firebaseAdminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: firebaseConfig.projectId });

const adminAuth = getAuth(firebaseAdminApp);

interface AuthenticatedRequest extends Request {
  uid?: string;
}

function getServerR2Config(): R2Config {
  // Prefer the plain R2_* names so the secret is never a VITE_-prefixed
  // variable (those are inlined into the client bundle by Vite).
  const accountId = (process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (
    process.env.R2_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY || ''
  ).trim();
  const bucketName =
    (process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME || 'my-photos').trim() ||
    'my-photos';
  const publicUrl = (process.env.R2_PUBLIC_URL || process.env.VITE_R2_PUBLIC_URL || '').trim();
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function getMissingConfigKeys(cfg: R2Config): string[] {
  const missing: string[] = [];
  if (!cfg.accountId) missing.push('R2_ACCOUNT_ID');
  if (!cfg.accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!cfg.secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!cfg.bucketName) missing.push('R2_BUCKET_NAME');
  if (!cfg.publicUrl) missing.push('R2_PUBLIC_URL');
  return missing;
}

async function requireFirebaseUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: Missing auth token' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.error('[auth] verifyIdToken failed:', err instanceof Error ? err.message : err);
    res.status(401).json({ error: 'Unauthorized: Invalid auth token' });
  }
}

async function startServer() {
  const app = express();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.get('/api/r2/status', (_req: Request, res: Response) => {
    const cfg = getServerR2Config();
    const missing = getMissingConfigKeys(cfg);
    res.json({
      configured: missing.length === 0,
      missing,
    });
  });

  app.put(
    '/api/r2/upload',
    requireFirebaseUser,
    express.raw({ type: '*/*', limit: '250mb' }),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const cfg = getServerR2Config();
        const missing = getMissingConfigKeys(cfg);
        if (missing.length > 0) {
          res.status(503).json({
            error: `Cloudflare R2 is not configured yet. Missing: ${missing.join(', ')}`,
          });
          return;
        }

        const uid = req.uid;
        if (!uid) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }

        const rawName = String(req.query.fileName || 'media');
        const contentType = String(
          req.query.fileType || req.headers['content-type'] || 'application/octet-stream'
        );
        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');

        if (bodyBuffer.length === 0) {
          res.status(400).json({ error: 'Empty upload body' });
          return;
        }

        const objectKey = buildObjectKey(uid, rawName);
        const r2Res = await r2Request(cfg, 'PUT', objectKey, bodyBuffer, contentType);

        if (!r2Res.ok) {
          const errText = await r2Res.text().catch(() => '');
          console.error(`[r2] upload failed ${r2Res.status}: ${errText.slice(0, 300)}`);
          res.status(502).json({
            error: `Cloudflare R2 upload failed (${r2Res.status})${
              errText ? ': ' + errText.slice(0, 160) : ''
            }`,
          });
          return;
        }

        const basePublic = cfg.publicUrl.replace(/\/+$/, '');
        const publicUrl = `${basePublic}/${encodeObjectKeyPath(objectKey)}`;
        res.json({ publicUrl, objectKey });
      } catch (err) {
        console.error('[r2] upload error:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Server upload failed',
        });
      }
    }
  );

  app.post(
    '/api/r2/delete',
    requireFirebaseUser,
    express.json(),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const cfg = getServerR2Config();
        const missing = getMissingConfigKeys(cfg);
        if (missing.length > 0) {
          res.status(503).json({
            error: `Cloudflare R2 is not configured yet. Missing: ${missing.join(', ')}`,
          });
          return;
        }

        const uid = req.uid;
        const fileUrl = String(req.body?.fileUrl || '');
        if (!uid || !fileUrl) {
          res.status(400).json({ error: 'Missing fileUrl' });
          return;
        }

        const objectKey = extractObjectKeyFromUrl(fileUrl, cfg);
        if (!objectKey || !objectKey.startsWith(`${uid}/`)) {
          res.status(403).json({ error: 'Forbidden: Invalid object key' });
          return;
        }

        const r2Res = await r2Request(cfg, 'DELETE', objectKey);

        if (!r2Res.ok && r2Res.status !== 204 && r2Res.status !== 404) {
          const errText = await r2Res.text().catch(() => '');
          console.error(`[r2] delete failed ${r2Res.status}: ${errText.slice(0, 300)}`);
          res.status(502).json({ error: `R2 delete failed (${r2Res.status})` });
          return;
        }

        res.json({ ok: true });
      } catch (err) {
        console.error('[r2] delete error:', err);
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Server delete failed',
        });
      }
    }
  );

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      try {
        const htmlPath = path.resolve(process.cwd(), 'index.html');
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
    const missing = getMissingConfigKeys(getServerR2Config());
    if (missing.length > 0) {
      console.warn(
        `[storage] Cloudflare R2 is NOT configured. Uploads will fail with 503.\n` +
          `[storage] Missing: ${missing.join(', ')}\n` +
          `[storage] Set these in .env (see .env.example) and restart.`
      );
    } else {
      console.log('[storage] Cloudflare R2 configuration detected.');
    }
  });
}

startServer();
