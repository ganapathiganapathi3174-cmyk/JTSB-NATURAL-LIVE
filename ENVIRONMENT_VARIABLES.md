# Environment Variables Reference

## Required Variables (Must be set in Vercel dashboard)

| Variable | Type | Purpose | Example |
|----------|------|---------|---------|
| `SUPABASE_URL` | Required | Supabase project URL for database operations | `https://gaqxnvqxgzcvbrpigiad.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Required | Supabase service role key (server-side only, never exposed to frontend) | `eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIs...` |
| `ADMIN_JWT_SECRET` | Required | Secret key for signing/admin-verifying JWT tokens. Must be 32+ chars, not the dev default | `GKvBwOex8YlW9HDTp52PRngthY8xLqfmTz8aNVBkRq7m` |
| `ADMIN_JWT_EXPIRY` | Required | JWT token expiry in seconds (default: `86400` = 24h) | `86400` |
| `ENCRYPTION_KEY` | Required | 32+ character key for AES-256-GCM encryption of sensitive fields (UTRs, emails, phones). Must be set in production | `M9gi6YormSLaRHjItfwVxTz8aNBkRq7mPL2wq4JnFyE` |
| `PORT` | Required | Server port for local dev (default: `3001`) | `3001` |
| `ADMIN_EMAIL` | Required | Email of the default admin user for the seed/admin login | `admin@yourdomain.com` |
| `ADMIN_PASSWORD` | Required | Password for admin seed user. Must be changed in production. (SHA-256 hashed in seed) | `ChangeMe123!` |
| `PAYMENT_CONFIRM_SECRET` | Required | Secret used to verify payment callback signatures | `pmt_secret_key_2026` |
| `SMS_PAYMENT_SECRET` | Required | Secret used for SMS payment confirmation verification | `sms_secret_key_2026` |
| `RAZORPAY_KEY_ID` | Required | Razorpay payment gateway key ID (if Razorpay integration is active) | `rzp_test_XXXXXXXXXXXX` |
| `RAZORPAY_KEY_SECRET` | Required | Razorpay payment gateway key secret | `rzp_test_XXXXXXXXXXXXXXXXXXXXXXXX` |

## Optional Variables (Used when the corresponding service is configured)

| Variable | Type | Purpose | Example |
|----------|------|---------|---------|
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Optional | Firebase service account JSON for Vision AI OCR fallback. When absent, OCR falls back to Tesseract.js (free, offline) | `{ "type": "service_account", "project_id": "..." }` |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for AI-powered text extraction from screenshots | `AIzaSyD...` |
| `GOOGLE_AI_API_KEY` | Optional | Google AI Platform API key (alternative to GEMINI_API_KEY) | `AIzaSyD...` |
| `OPENAI_API_KEY` | Optional | OpenAI API key for AI-powered verification and text analysis | `sk-proj-...` |
| `R2_ACCESS_KEY_ID` | Optional | Cloudflare R2 storage access key for screenshot/image storage | `R2_ACCESS_KEY_ID` |
| `R2_SECRET_ACCESS_KEY` | Optional | Cloudflare R2 storage secret key | `R2_SECRET_ACCESS_KEY` |
| `R2_BUCKET` | Optional | R2 bucket name for storing payment screenshots | `jtsb-payments` |
| `R2_ENDPOINT` | Optional | R2 endpoint URL (default uses Cloudflare global CDN) | `https://your-account.r2.cloudflarestorage.com` |
| `R2_PUBLIC_DOMAIN` | Optional | Public domain URL for R2 objects (used in screenshot URLs returned to frontend) | `https://r2.jtsb.in` |
| `NEON_DATABASE_URL` | Optional | Neon PostgreSQL URL for analytics and reporting | `postgres://user:pass@ep-xxx.neon.tech/db` |
| `TURSO_DATABASE_URL` | Optional | Turso libSQL URL for backup database replication | `libsql://your-db.turso.io` |
| `TURSO_AUTH_TOKEN` | Optional | Turso authentication token for backup database | `tk_XXXXXXXXXXXXXXXXXXXXXXXX` |
| `TURSO_URL` | Optional | Alias for TURSO_DATABASE_URL | `libsql://your-db.turso.io` |
| `COMPANION_API_KEY` | Optional | Companion key for companion authentication on payment endpoints | `companion_key_2026` |
| `CF_IP` | Optional | Cloudflare IP for rate limiting (if using Cloudflare as CDN) | `1.2.3.4` |
| `AUTO_APPROVE_CONFIDENCE` | Optional | Minimum OCR confidence score threshold for auto-approval (default: `90`) | `90` |
| `PENDING_PAYMENT_TIMEOUT_MINUTES` | Optional | Minutes before a pending payment order times out (default: `30`) | `30` |
| `ADMIN_PASSWORD_HASH` | Optional | Pre-computed SHA-256 hash of admin password (used in seed instead of plaintext) | `e3b0c44298fc1c149afbf4c8996fb924...` |
| `TEST_MODE` | Optional | Enable test mode (disables real payment processing, uses mock responses) | `true` |
| `VERCEL` | Internal | Set automatically by Vercel deployment platform. Do not set manually. | `1` |
| `E2E_BASE_URL` | Optional | Base URL used by E2E test script for making HTTP requests | `http://localhost:3001` |

## Important Notes

### Production Security Requirements
1. **`ADMIN_JWT_SECRET`**: Must NOT be `dev-jwt-secret-not-for-production`. Generate a cryptographically random 32+ char string.
2. **`ENCRYPTION_KEY`**: Must be exactly 32 bytes (for AES-256-GCM). Must NOT be a placeholder.
3. **`ADMIN_PASSWORD`**: The seed admin password must be changed immediately after first login in production.
4. **`RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`**: Use production keys (not test keys) in production.
5. **`SUPABASE_SERVICE_KEY`**: This is a secret key with full database access. NEVER expose it to the frontend. It is server-side only.

### Vercel-Specific Setup
- Add all variables in Vercel dashboard → Project → Settings → Environment Variables
- Set `VERCEL=1` is automatic (set by Vercel platform)
- Variables marked as "Production" in Vercel are only available in production deployments
- For preview/staging deployments, also set them as "Preview" environment variables