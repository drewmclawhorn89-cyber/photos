interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export interface R2Status {
  configured: boolean;
  missing: string[];
}

function getR2Config(): R2Config {
  const accountId = (import.meta.env.VITE_R2_ACCOUNT_ID as string | undefined)?.trim() ?? '';
  const accessKeyId = (import.meta.env.VITE_R2_ACCESS_KEY_ID as string | undefined)?.trim() ?? '';
  const secretAccessKey = (import.meta.env.VITE_R2_SECRET_ACCESS_KEY as string | undefined)?.trim() ?? '';
  const bucketName = (import.meta.env.VITE_R2_BUCKET_NAME as string | undefined)?.trim() || 'my-photos';
  const publicUrl = (import.meta.env.VITE_R2_PUBLIC_URL as string | undefined)?.trim() ?? '';

  return { accountId, accessKeyId, secretAccessKey, bucketName, publicUrl };
}

export function isR2Configured(): boolean {
  const cfg = getR2Config();
  return Boolean(
    cfg.accountId &&
      cfg.accessKeyId &&
      cfg.secretAccessKey &&
      cfg.bucketName &&
      cfg.publicUrl
  );
}

export function getMissingR2Keys(): string[] {
  const missing: string[] = [];
  const r2 = getR2Config();
  if (!r2.accountId) missing.push('VITE_R2_ACCOUNT_ID');
  if (!r2.accessKeyId) missing.push('VITE_R2_ACCESS_KEY_ID');
  if (!r2.secretAccessKey) missing.push('VITE_R2_SECRET_ACCESS_KEY');
  if (!r2.bucketName) missing.push('VITE_R2_BUCKET_NAME');
  if (!r2.publicUrl) missing.push('VITE_R2_PUBLIC_URL');
  return missing;
}

export async function fetchR2Status(): Promise<R2Status> {
  try {
    const res = await fetch('/api/r2/status');
    if (res.ok) {
      return (await res.json()) as R2Status;
    }
  } catch {
    // Fall back to client env inspection if server route is unavailable
  }
  const missing = getMissingR2Keys();
  return { configured: missing.length === 0, missing };
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toHex(hash);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const rawKey = key instanceof Uint8Array ? key : new Uint8Array(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function getSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kSecret = new TextEncoder().encode('AWS4' + secretAccessKey);
  const kDate = await hmacSha256(kSecret, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function formatAmzDates(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function encodeObjectKeyPath(key: string): string {
  return key
    .split('/')
    .filter(Boolean)
    .map((seg) => rfc3986Encode(seg))
    .join('/');
}

async function createPresignedPutUrl(cfg: R2Config, objectKey: string, expiresSeconds = 900): Promise<string> {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const { amzDate, dateStamp } = formatAmzDates();
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const encodedKey = encodeObjectKeyPath(objectKey);
  const canonicalUri = `/${rfc3986Encode(cfg.bucketName)}/${encodedKey}`;

  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${cfg.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQueryString = Object.keys(queryParams)
    .sort()
    .map((k) => `${rfc3986Encode(k)}=${rfc3986Encode(queryParams[k])}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const signingKey = await getSigningKey(cfg.secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(signatureBuffer);

  return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

function buildObjectKey(userId: string, fileName: string): string {
  const dotIdx = fileName.lastIndexOf('.');
  const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
  const ext = dotIdx > 0 ? fileName.slice(dotIdx).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  const cleanBase = base
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'media';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${userId}/${unique}-${cleanBase}${ext}`;
}

export async function uploadToR2(
  file: File,
  userId: string,
  idToken: string,
  onProgress: (percent: number) => void,
  resolvedMimeType?: string
): Promise<{ publicUrl: string; objectKey: string }> {
  const mimeType = resolvedMimeType || file.type || 'application/octet-stream';

  // Primary path: upload via server proxy (/api/r2/upload) to avoid browser R2 CORS errors
  const proxyResult = await new Promise<{ publicUrl: string; objectKey: string } | 'NOT_FOUND'>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `/api/r2/upload?fileName=${encodeURIComponent(file.name)}&fileType=${encodeURIComponent(mimeType)}`;
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);
      xhr.setRequestHeader('Content-Type', mimeType);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
        }
      };

      xhr.onload = () => {
        if (xhr.status === 404) {
          resolve('NOT_FOUND');
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText) as { publicUrl: string; objectKey: string };
            onProgress(100);
            resolve(data);
          } catch {
            reject(new Error('Invalid upload response from server'));
          }
          return;
        }
        try {
          const errData = JSON.parse(xhr.responseText) as { error?: string };
          reject(new Error(errData.error || `Upload failed with HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed with HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error while uploading file'));
      xhr.onabort = () => reject(new Error('Upload canceled'));
      xhr.send(file);
    }
  );

  if (proxyResult !== 'NOT_FOUND') {
    return proxyResult;
  }

  // Fallback for pure static builds: direct presigned S3 PUT to R2
  const cfg = getR2Config();
  if (!isR2Configured()) {
    throw new Error(
      'Cloudflare R2 keys are missing. Add VITE_R2_ACCOUNT_ID, VITE_R2_ACCESS_KEY_ID, VITE_R2_SECRET_ACCESS_KEY, VITE_R2_BUCKET_NAME, and VITE_R2_PUBLIC_URL to your Secrets or .env file.'
    );
  }

  const objectKey = buildObjectKey(userId, file.name);
  const presignedUrl = await createPresignedPutUrl(cfg, objectKey);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', presignedUrl, true);
    xhr.setRequestHeader('Content-Type', mimeType);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`R2 upload failed with HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => {
      reject(
        new Error(
          'Upload blocked or network failed. Check your internet connection and verify R2 CORS allows PUT from this origin.'
        )
      );
    };

    xhr.onabort = () => reject(new Error('Upload canceled'));
    xhr.send(file);
  });

  const basePublic = cfg.publicUrl.replace(/\/+$/, '');
  const publicUrl = `${basePublic}/${encodeObjectKeyPath(objectKey)}`;
  return { publicUrl, objectKey };
}

function extractObjectKeyFromUrl(fileUrl: string, cfg: R2Config): string | null {
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
    let path = parsed.pathname.replace(/^\/+/, '');
    if (path.startsWith(`${cfg.bucketName}/`)) {
      path = path.slice(cfg.bucketName.length + 1);
    }
    return path
      .split('/')
      .filter(Boolean)
      .map((s) => decodeURIComponent(s))
      .join('/');
  } catch {
    return null;
  }
}

export async function deleteFromR2(fileUrl: string, idToken: string): Promise<void> {
  // Primary path: delete via server proxy
  const proxyRes = await fetch('/api/r2/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fileUrl }),
  });

  if (proxyRes.status !== 404) {
    if (!proxyRes.ok) {
      const errData = (await proxyRes.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || `R2 delete failed (${proxyRes.status})`);
    }
    return;
  }

  // Fallback for pure static builds
  const cfg = getR2Config();
  if (!isR2Configured()) {
    throw new Error('Cloudflare R2 environment variables are missing.');
  }

  const objectKey = extractObjectKeyFromUrl(fileUrl, cfg);
  if (!objectKey) {
    throw new Error('Could not determine R2 object key for file.');
  }

  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const { amzDate, dateStamp } = formatAmzDates();
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const encodedKey = encodeObjectKeyPath(objectKey);
  const canonicalUri = `/${rfc3986Encode(cfg.bucketName)}/${encodedKey}`;
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

  const canonicalRequestHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    canonicalRequestHash,
  ].join('\n');

  const signingKey = await getSigningKey(cfg.secretAccessKey, dateStamp, region, service);
  const signatureBuffer = await hmacSha256(signingKey, stringToSign);
  const signature = toHex(signatureBuffer);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}${canonicalUri}`, {
    method: 'DELETE',
    headers: {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
    },
  });

  if (!response.ok && response.status !== 204 && response.status !== 404) {
    throw new Error(`R2 delete failed with HTTP ${response.status}`);
  }
}
