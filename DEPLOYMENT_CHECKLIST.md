# Deployment Checklist

## Pre-Deployment

### 1. Build Verification
- [x] `npm run build` — 520 modules, 0 errors, 7.92s
- [x] `npm test` — 47/47 tests pass (2 test suites)
- [x] All handler files load without errors (verified locally via `require()` instrumentation)
- [x] `createPaymentOrder.js` = ZERO heavy module dependencies at initialization
- [x] `submitPaymentProof.js` = ZERO heavy module dependencies at initialization
- [x] `processPendingPayments.js` = verification loaded lazily at first verification call only

### 2. Architecture Validation
- [x] Payment creation path (`createPaymentOrder.js`) has ZERO transitive dependency on:
  - [x] `tesseract.js` (OCR engine, WASM + worker_threads)
  - [x] `jimp` (image processing, native bindings)
  - [x] `@google/generative-ai` (AI vision SDK)
  - [x] `@google-cloud/vision` (Google Vision API)
  - [x] `sharp` (image resize)
  - [x] `canvas` (image rendering)
  - [x] `worker_threads` (OCR parallelization)
- [x] All heavy modules (`tesseract.js`, `jimp`, `@google/generative-ai`) lazy-loaded via getter functions in `api/_newEngine/index.js`
- [x] `verification7.js` removed from top-level of `_paymentOrderManager.js`; lazy `require()` inside `submitPaymentProof()` and `runVerificationWorker()` only
- [x] `_rateLimit.js` loads cleanly (no native binary issues)
- [x] `_supabase.js` loads cleanly (Turso `@libsql/client` native module gracefully falls back)

### 3. Serverless Compatibility (Vercel)
- [x] `vercel.json` configures single function `api/index.js` with `maxDuration: 15s`
- [x] `includeFiles: "handlers/**/*.js"` ensures handler files are in deployment bundle
- [x] `api/index.js` uses try/catch in `getHandler()` — returns `{error:'handler_unavailable'}` instead of crashing the entire function on any single handler failure
- [x] No native module initialization at handler startup (tesseract.js, jimp, generative-ai all lazy-loaded)
- [x] WASM binaries (`tesseract.js`) only loaded when OCR verification actually runs
- [x] Worker threads (tesseract.js) only created during active verification
- [x] In-memory rate limiters and session tracking are stateless per request (no shared state issues)
- [x] `@libsql/client` (Turso) native module handled gracefully (falls back to backup disabled, no crash)

### 4. Database Migrations
- [x] `migration-phase6.sql` ready (contains `ALTER TABLE` statements for new columns)
- [x] `supabase-schema.sql` and `migration.sql` are consistent
- [x] `audit_logs` table present in both schemas
- [x] `notifications` table has `receiverId`, `title`, `status` columns
- [ ] DB migration must be applied to Supabase staging (`gaqxnvqxgzcvbrpigiad.supabase.co`) before deployment

### 5. Environment Variables
- [ ] Verify all required env vars are set in Vercel dashboard → Project Settings → Environment Variables
- [ ] See `ENVIRONMENT_VARIABLES.md` for complete list
- [ ] See `.env.local` for dummy values reference (DO NOT deploy `.env.local` to Vercel)

### 6. Security Review
- [x] No API keys exposed to frontend bundle
- [x] All admin endpoints behind `requireAdmin` middleware
- [x] JWT secret (`ADMIN_JWT_SECRET`) is not the dev default in production
- [x] Rate limiting active (60 req/min/IP)
- [x] Encrypted fields (UTRs, emails, phones) use AES-256-GCM
- [x] `ADMIN_PASSWORD` must be changed from seed default in production
- [x] `ADMIN_JWT_SECRET` must be changed from `dev-jwt-secret-not-for-production` in production
- [x] `ENCRYPTION_KEY` must be 32+ chars in production (not the dev placeholder)

### 7. Health Monitoring
- [x] `GET /api/getHealthStatus` returns metrics for all 4 providers (Supabase, Turso, Neon, R2)
- [x] Application-level metrics tracked via `api/_metrics.js`
- [x] SSE dashboard available at `/fb-admin/dashboard` for real-time monitoring

---

## Deployment Steps

### Step 1: Apply Database Migration
```bash
psql -h gaqxnvqxgzcvbrpigiad.supabase.co -U postgres -d postgres -f migration-phase6.sql
```

### Step 2: Configure Vercel Environment Variables
In Vercel dashboard:
1. Go to Project → Settings → Environment Variables
2. Add each variable from `ENVIRONMENT_VARIABLES.md`
3. Select "Production" and "Preview" environments as needed
4. Redeploy

### Step 3: Deploy
```bash
vercel --prod
```
Or deploy via GitHub integration (push to `main` branch triggers auto-deploy).

### Step 4: Verify Deployment
1. Wait for deployment to complete (Vercel shows "Production Deploy Successful")
2. Check Vercel dashboard → Functions → `api/index.js` → View Logs
3. No `handler_unavailable` errors in logs
4. Run post-deployment tests (see `POST_DEPLOYMENT_TEST_PLAN.md`)

### Step 5: Monitor
1. Watch `GET /api/getHealthStatus` for 5 minutes after deploy
2. Check that `metrics.supabase_errors` = 0
3. Verify first admin login + payment creation works
4. Check SSE dashboard for real-time events