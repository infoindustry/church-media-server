# Church Media Cloud Portal

Cloudflare-only transfer portal for the church mini PC.

The portal is intentionally a temporary mailbox:

1. Users upload MP4/MP3 files through a password-protected page.
2. Browser uploads directly to private R2 using a short-lived signed URL.
3. D1 stores metadata and the `pending` queue.
4. The mini PC polls the Worker, downloads pending files, registers them locally, then marks them `synced`.
5. After `synced`, the Worker deletes the R2 object.
6. A daily Cron Trigger cleans up stale uploaded objects if a device never downloads them.

## Cloudflare resources

Create:

```bash
wrangler r2 bucket create church-media-transfer
wrangler d1 create church_media_portal
```

Put the D1 `database_id` into `wrangler.toml`.

Apply schema:

```bash
npm run db:migrate:remote
```

If the database already existed before the "add to plan" option, also run:

```bash
npm run db:migrate:plan-fields:remote
```

Set secrets:

```bash
wrangler secret put PORTAL_PASSWORD
wrangler secret put SESSION_SECRET
wrangler secret put DEVICE_TOKEN
wrangler secret put R2_ACCESS_KEY_ID
wrangler secret put R2_SECRET_ACCESS_KEY
```

`R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` must be an R2 token that can read/write the `church-media-transfer` bucket.

Update `R2_ACCOUNT_ID` and `R2_BUCKET_NAME` in `wrangler.toml`.

## R2 CORS

Direct browser uploads need bucket CORS. Edit `r2-cors.json`, replace the origin with your deployed portal domain, then apply it from Cloudflare dashboard or Wrangler.

For local `wrangler dev`, temporarily add:

```json
"http://localhost:8787"
```

to `AllowedOrigins`.

## Deploy

```bash
npm install
npm run deploy
```

## Mini PC env

Add these to the root `.env` of the local church media server:

```env
CLOUD_SYNC_URL=https://your-worker.your-subdomain.workers.dev
CLOUD_SYNC_DEVICE_ID=mini-pc-main
CLOUD_SYNC_DEVICE_NAME=Church Mini PC
CLOUD_SYNC_DEVICE_TOKEN=the-same-device-token-secret
CLOUD_SYNC_INTERVAL_MS=10000
```

When these variables are absent, the local server behaves exactly as before.
