import crypto from 'node:crypto';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (ch) => '%' + ch.charCodeAt(0).toString(16).toUpperCase()
  );
}

export function encodeObjectKeyPath(key: string): string {
  return key
    .split('/')
    .filter(Boolean)
    .map((seg) => rfc3986Encode(seg))
    .join('/');
}

export function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function hmacSha256(key: Buffer | string, message: string): Buffer {
  return crypto.createHmac('sha256', key).update(message).digest();
}

export function getSigningKey(secretAccessKey: string, dateStamp: string): Buffer {
  const kDate = hmacSha256('AWS4' + secretAccessKey, dateStamp);
  const kRegion = hmacSha256(kDate, 'auto');
  const kService = hmacSha256(kRegion, 's3');
  return hmacSha256(kService, 'aws4_request');
}

export function formatAmzDates(date = new Date()): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

export function buildObjectKey(userId: string, fileName: string): string {
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

export function extractObjectKeyFromUrl(fileUrl: string, cfg: R2Config): string | null {
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

/**
 * Performs a signed request against the R2 S3-compatible endpoint.
 *
 * The payload hash is always the real SHA-256 of the body, which R2 requires
 * for PUT requests. DELETE sends an empty body.
 */
export async function r2Request(
  cfg: R2Config,
  method: 'PUT' | 'DELETE',
  objectKey: string,
  body?: Buffer,
  contentType?: string
): Promise<Response> {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const encodedKey = encodeObjectKeyPath(objectKey);
  const canonicalUri = `/${rfc3986Encode(cfg.bucketName)}/${encodedKey}`;
  const { amzDate, dateStamp } = formatAmzDates();
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const payload = body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);

  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
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
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };
  if (method === 'PUT' && contentType) {
    headers['Content-Type'] = contentType;
  }

  return fetch(`https://${host}${canonicalUri}`, {
    method,
    headers,
    body: method === 'PUT' ? new Uint8Array(payload) : undefined,
  });
}
