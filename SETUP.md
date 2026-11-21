# Storage setup (Cloudflare R2)

The app stores photo and video files in Cloudflare R2 and keeps metadata in
Firestore. Uploads go through the Express server, which signs every R2 request.
The browser never holds an R2 credential.

## 1. Create a bucket

Cloudflare dashboard -> **R2** -> **Create bucket**. Note the bucket name.

## 2. Create an API token

R2 -> **Manage R2 API Tokens** -> **Create API token**.

- Permission: **Object Read & Write**
- Scope: the bucket from step 1

Copy the **Access Key ID** and **Secret Access Key**. The secret is shown only
once.

## 3. Enable public read access

Bucket -> **Settings** -> **Public access**. Either enable the **r2.dev**
development URL or attach a custom domain. This base URL is `R2_PUBLIC_URL`.

Without this, uploads succeed but images will not load in the gallery.

## 4. Fill in `.env`

```bash
cp .env.example .env
```

```dotenv
R2_ACCOUNT_ID="<32-char hex account id>"
R2_ACCESS_KEY_ID="<access key id>"
R2_SECRET_ACCESS_KEY="<secret access key>"
R2_BUCKET_NAME="my-photos"
R2_PUBLIC_URL="https://pub-xxxxxxxx.r2.dev"
```

`R2_PUBLIC_URL` must have no trailing slash. Do **not** prefix these with
`VITE_` — Vite inlines `VITE_*` variables into the client bundle, which would
expose your secret key to every visitor.

## 5. Verify

```bash
npm run verify:r2
```

This uploads a small test object, fetches it over the public URL, then deletes
it. It uses the same signing code as the server, so a pass means real uploads
will work.

## 6. Run

```bash
npm run dev      # development, Vite middleware + API
npm run build    # build the client into dist/
npm start        # production server serving dist/ + API
```

`GET /api/r2/status` reports which variables are still missing.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `503 Cloudflare R2 is not configured` | One or more `R2_*` vars missing; restart after editing `.env` |
| `502 ... SignatureDoesNotMatch` | Wrong access key or secret |
| `502 ... NoSuchBucket` | `R2_BUCKET_NAME` does not match the bucket |
| Upload works, images broken | Public access not enabled, or `R2_PUBLIC_URL` wrong |
| `401 Unauthorized` | Firebase ID token missing or expired; sign in again |
