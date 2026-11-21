import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

const PORT = 3000;

const firebaseAdminApp = getApps().length
  ? getApp()
  : initializeApp({ projectId: firebaseConfig.projectId });

const adminAuth = getAuth(firebaseAdminApp);

interface AuthenticatedRequest extends Request {
  uid?: string;
}

interface ServerR2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

function getServerR2Config(): ServerR2Config {
  const accountId = (process.env.VITE_R2_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.VITE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.VITE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = (process.env.VITE_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME || 'my-photos').trim() || 'my-photos';
  const publicUrl = (process.env.VITE_R2_PUBLIC_URL || process.env.R2_PUBLIC_URL || '').trim();
  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

function getMissingConfigKeys(cfg: ServerR2Config): string[] {
  const missing: string[] = [];
  if (!cfg.accountId) missing.push('VITE_R2_ACCOUNT_ID');
  if (!cfg.accessKeyId) missing.push('VITE_R2_ACCESS_KEY_ID');
  if (!cfg.secretAccessKey) missing.push('VITE_R2_SECRET_ACCESS_KEY');
  if (!cfg.bucketName) missing.push('VITE_R2_BUCKET_NAME');
  if (!cfg.publicUrl) missing.push('VITE_R2_PUBLIC_URL');
  return missing;
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodeObjectKeyPath(key: string): string {
  return key
    .split('/')
    .filter(Boolean)
    .map((seg) => rfc3986Encode(seg))
    .join('/');
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, message: string): Buffer {
  return crypto.createHmac('sha256', key).update(message).digest();
}

function getSigningKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmacSha256('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmacSha256(kDate, 'auto');
  const kService = hmacSha256(kRegion, 's3');
  return hmacSha256(kService, 'aws4_request');
}

function formatAmzDates(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function buildObjectKey(userId: string, fileName: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  const cleanBase =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'media';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${userId}/${unique}-${cleanBase}${ext}`;
}

function extractObjectKeyFromUrl(fileUrl: string, cfg: ServerR2Config): string | null {
  const cleanPublic = cfg.publicUrl.replace(/\/+$/, '');
  if (cleanPublic && fileUrl.startsWith(cleanPublic + '/')) {
    const rawKey = fileUrl.slice(cleanPublic.length + 1);
    return rawKey
      .split('/')
      .map((s) => decodeURIComponent(s))
      .join('/');
  }
  try {
    const parsed = new URL(fileUrl);
    let keyPath = parsed.pathname.replace(/^\/+/, '');
    if (keyPath.startsWith(`${cfg.bucketName}/`)) {
      keyPath = keyPath.slice(cfg.bucketName.length + 1);
    }
    return keyPath
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s))
      .join('/');
  } catch {
    return null;
  }
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
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid auth token' });
  }
}

async function startServer() {
  const app = express();

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
        const contentType = String(req.query.fileType || req.headers['content-type'] || 'application/octet-stream');
        const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? '');

        if (bodyBuffer.length === 0) {
          res.status(400).json({ error: 'Empty upload body' });
          return;
        }

        const objectKey = buildObjectKey(uid, rawName);
        const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
        const encodedKey = encodeObjectKeyPath(objectKey);
        const canonicalUri = `/${rfc3986Encode(cfg.bucketName)}/${encodedKey}`;
        const { amzDate, dateStamp } = formatAmzDates();
        const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
        const payloadHash = sha256Hex(bodyBuffer);

        const canonicalHeaders =
          `host:${host}\n` +
          `x-amz-content-sha256:${payloadHash}\n` +
          `x-amz-date:${amzDate}\n`;
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

        const canonicalRequest = [
          'PUT',
          canonicalUri,
          '',
          canonicalHeaders,
          signedHeaders,
          payloadHash,
        ].join('\n');

        const stringToSign = [
          'AWS4-HMAC-SHA256',
          amzDate,
          credentialScope,
          sha256Hex(canonicalRequest),
        ].join('\n');

        const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp);
        const signature = crypto
          .createHmac('sha256', signingKey)
          .update(stringToSign)
          .digest('hex');

        const authorization =
          `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const r2Res = await fetch(`https://${host}${canonicalUri}`, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            Authorization: authorization,
          },
          body: new Uint8Array(bodyBuffer),
        });

        if (!r2Res.ok) {
          const errText = await r2Res.text().catch(() => '');
          res.status(502).json({
            error: `Cloudflare R2 upload failed (${r2Res.status})${errText ? ': ' + errText.slice(0, 160) : ''}`,
          });
          return;
        }

        const basePublic = cfg.publicUrl.replace(/\/+$/, '');
        const publicUrl = `${basePublic}/${encodedKey}`;
        res.json({ publicUrl, objectKey });
      } catch (err) {
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

        const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
        const encodedKey = encodeObjectKeyPath(objectKey);
        const canonicalUri = `/${rfc3986Encode(cfg.bucketName)}/${encodedKey}`;
        const { amzDate, dateStamp } = formatAmzDates();
        const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
        const payloadHash = 'UNSIGNED-PAYLOAD';

        const canonicalHeaders =
          `host:${host}\n` +
          `x-amz-content-sha256:${payloadHash}\n` +
          `x-amz-date:${amzDate}\n`;
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

        const canonicalRequest = [
          'DELETE',
          canonicalUri,
          '',
          canonicalHeaders,
          signedHeaders,
          payloadHash,
        ].join('\n');

        const stringToSign = [
          'AWS4-HMAC-SHA256',
          amzDate,
          credentialScope,
          sha256Hex(canonicalRequest),
        ].join('\n');

        const signingKey = getSigningKey(cfg.secretAccessKey, dateStamp);
        const signature = crypto
          .createHmac('sha256', signingKey)
          .update(stringToSign)
          .digest('hex');

        const authorization =
          `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
          `SignedHeaders=${signedHeaders}, Signature=${signature}`;

        const r2Res = await fetch(`https://${host}${canonicalUri}`, {
          method: 'DELETE',
          headers: {
            'x-amz-content-sha256': payloadHash,
            'x-amz-date': amzDate,
            Authorization: authorization,
          },
        });

        if (!r2Res.ok && r2Res.status !== 204 && r2Res.status !== 404) {
          res.status(502).json({ error: `R2 delete failed (${r2Res.status})` });
          return;
        }

        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Server delete failed',
        });
      }
    }
  );

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    app.use('*all', async (req, res, next) => {
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
  });
}

startServer();
