/**
 * Verifies Cloudflare R2 credentials end-to-end using the exact same signing
 * code the server uses.
 *
 *   npx tsx scripts/verify-r2.ts
 *
 * Steps: config check -> signed PUT -> public URL fetch -> signed DELETE.
 * Exits non-zero on the first failure so it can be used in CI.
 */
import 'dotenv/config';
import {
  buildObjectKey,
  encodeObjectKeyPath,
  r2Request,
  type R2Config,
} from '../r2Signing';

function loadConfig(): R2Config {
  return {
    accountId: (process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID || '').trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (
      process.env.R2_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY || ''
    ).trim(),
    bucketName:
      (process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME || 'my-photos').trim() ||
      'my-photos',
    publicUrl: (process.env.R2_PUBLIC_URL || process.env.VITE_R2_PUBLIC_URL || '').trim(),
  };
}

const ok = (msg: string) => console.log(`  \u2713 ${msg}`);
const bad = (msg: string) => console.log(`  \u2717 ${msg}`);

async function main(): Promise<void> {
  console.log('\nCloudflare R2 verification\n');

  const cfg = loadConfig();
  const missing = (
    [
      ['R2_ACCOUNT_ID', cfg.accountId],
      ['R2_ACCESS_KEY_ID', cfg.accessKeyId],
      ['R2_SECRET_ACCESS_KEY', cfg.secretAccessKey],
      ['R2_BUCKET_NAME', cfg.bucketName],
      ['R2_PUBLIC_URL', cfg.publicUrl],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    bad(`Missing configuration: ${missing.join(', ')}`);
    console.log('\nAdd these to .env and re-run. See .env.example for the format.\n');
    process.exit(1);
  }
  ok('All five variables are present');

  const objectKey = buildObjectKey('__verify__', 'connection-test.txt');
  const body = Buffer.from(`r2 verification ${new Date().toISOString()}`);

  console.log('\nUploading test object...');
  const putRes = await r2Request(cfg, 'PUT', objectKey, body, 'text/plain');
  if (!putRes.ok) {
    const text = await putRes.text().catch(() => '');
    bad(`PUT failed with HTTP ${putRes.status}`);
    console.log(`     ${text.slice(0, 400)}`);
    console.log(
      '\n  Common causes:\n' +
        '   - Wrong access key / secret, or the token lacks Object Read & Write\n' +
        '   - Bucket name does not match the bucket in Cloudflare\n' +
        '   - Account ID is not the 32-char hex ID from the R2 dashboard\n'
    );
    process.exit(1);
  }
  ok(`Uploaded ${objectKey}`);

  const publicUrl = `${cfg.publicUrl.replace(/\/+$/, '')}/${encodeObjectKeyPath(objectKey)}`;
  console.log('\nChecking public URL...');
  const getRes = await fetch(publicUrl);
  if (getRes.ok) {
    ok(`Public URL reachable (HTTP ${getRes.status})`);
  } else {
    bad(`Public URL returned HTTP ${getRes.status}`);
    console.log(
      '\n  The object uploaded, but it is not publicly readable.\n' +
        '  Enable "Public Development URL" (r2.dev) on the bucket, or attach a\n' +
        '  custom domain, then set R2_PUBLIC_URL to that base URL.\n'
    );
  }

  console.log('\nCleaning up test object...');
  const delRes = await r2Request(cfg, 'DELETE', objectKey);
  if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
    ok('Test object deleted');
  } else {
    bad(`DELETE failed with HTTP ${delRes.status}`);
  }

  console.log('\nR2 is ready for uploads.\n');
}

main().catch((err) => {
  console.error('\nVerification crashed:', err instanceof Error ? err.message : err, '\n');
  process.exit(1);
});
