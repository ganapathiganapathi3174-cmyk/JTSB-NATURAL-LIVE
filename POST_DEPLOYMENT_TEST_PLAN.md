# Post-Deployment Test Plan

## Prerequisites
- Deployment completed successfully (Vercel shows "Production Deploy Successful")
- Database migrations in `migration-phase6.sql` applied to Supabase staging
- All environment variables configured in Vercel dashboard
- `VERCEL_ENV` is `production`

## Phase 1: Infrastructure Health

### 1.1 Health Endpoint
```bash
curl https://<your-project>.vercel.app/api/getHealthStatus
```
**Expected:** HTTP `200`, response body `{ status: "ok", ... }`
**Check:** All providers report status — `supabase: ok`, Turso/Neon as acceptable fallback.

**Time:** <3 seconds

### 1.2 Cold Start Test
```bash
sleep 60; curl https://<project>.vercel.app/api/getHealthStatus
```
**Expected:** Cold start response <15s (Vercel `maxDuration: 15`)

---

## Phase 2: Payment Creation (ZERO Heavy Modules at Init)

### 2.1 Create Payment Order — ₹120 (Membership)
```bash
curl -X POST https://<project>.vercel.app/api/createPaymentOrder \
  -H "Content-Type: application/json" \
  -d '{"type":"registration","amount":120,"userId":"test120","pendingRegId":"pend120"}'
```
**Expected:** HTTP `200` with `orderId`, `upiId`, `amount: 120`
**FAIL:** `{ error: "handler_unavailable" }` → STOP, rollback immediately.

### 2.2 Create Payment Order — ₹500 (Topup)
```bash
curl -X POST https://<project>.vercel.app/api/createPaymentOrder \
  -H "Content-Type: application/json" \
  -d '{"type":"topup","amount":500,"userId":"test500"}'
```
**Expected:** HTTP `200` with valid `orderId`.

### 2.3 Create Payment Order — ₹1000 (Topup)
```bash
curl -X POST https://<project>.vercel.app/api/createPaymentOrder \
  -H "Content-Type: application/json" \
  -d '{"type":"topup","amount":1000,"userId":"test1000"}'
```
**Expected:** HTTP `200` with valid `orderId`.

### 2.4 Cold Start — Payment Creation (Critical)
```bash
sleep 60  # Force cold start
curl -X POST https://<project>.vercel.app/api/createPaymentOrder ...
```
**Expected:** HTTP `200`, <5s start. Confirms NO tesseract.js/jimp/AI loading at init.

---

## Phase 3: Verification Pipeline (Lazy-Loaded)

### 3.1 Admin Login
```bash
curl -X POST https://<project>.vercel.app/api/adminLogin \
  -d '{"email":"admin@yourdomain.com","password":"<ADMIN_PASSWORD>"}'
```
**Expected:** HTTP `200`, `{ token: "eyJ...", admin: {...} }`

### 3.2 Submit Screenshot
```bash
curl -X POST https://<project>.vercel.app/api/submitPaymentProof \
  -d '{"orderId":"<order_id>","screenshot":"data:image/png;base64,...","utr":"123456789012"}'
```
**Expected:** HTTP `200` within 20s, `status` + `ocrData` in response.

### 3.3 Process Pending Payments
```bash
curl -X POST https://<project>.vercel.app/api/processPendingPayments \
  -H "Authorization: Bearer <token>"
```
**Expected:** HTTP `200`, `{ processed: N, approved: M, rejected: K }`.

---

## Phase 4: End-to-End Payment Flow

### 4.1 Full Flow: ₹120 Membership
Pre-register → Create order → Upload screenshot → Process → ✅ User created + wallet credited

### 4.2 Full Flow: ₹500 Topup
Login → Create order → Upload screenshot → Process → ✅ Wallet +₹500

### 4.3 Full Flow: ₹1000 Topup
Create order → Upload screenshot → Process → Approve → ✅ Wallet +₹1000

---

## Phase 5: Admin Operations

| Operation | Test | Expected |
|-----------|------|----------|
| Approve | `POST /api/approveUPIPayment` | 200 + `approved` |
| Reject | `POST /api/rejectUPIPayment` | 200 + `rejected` |
| Dashboard | `GET /api/getAdminDashboardData` | 200 + metrics |
| Queue | `GET /api/getQueueStatus` | 200 + queue counts |
| Logout | `POST /api/adminLogout` | 200 + token blacklisted |
| JWT Blocked | Retry old token | 401 |

---

## Phase 6: Runtime Log Inspection (Vercel Logs)

**MUST NOT see:** `handler_unavailable`, `MODULE_NOT_FOUND`, `worker_threads` errors, `tesseract.js` init failure
**OK to see:** `[OCR]` logs only during screenshot processing, `[VERIFY]` logs during verification

---

## Validation Summary

| Test | Expected | Status |
|------|----------|--------|
| Health check | 200 OK | ⬜ |
| Payment ₹120 | 200 + orderId | ⬜ |
| Payment ₹500 | 200 + orderId | ⬜ |
| Payment ₹1000 | 200 + orderId | ⬜ |
| No handler_unavailable | All routes | ⬜ |
| No startup exceptions | Logs clean | ⬜ |
| Full E2E flow | All pass | ⬜ |

**Deployment Status:** ⬜ PENDING | ⬜ PASS | ❌ FAIL

**Notes:**
- OCR/AI modules should ONLY appear in Vercel logs during `submitPaymentProof` / `processPendingPayments` calls
- `createPaymentOrder` logs should NOT contain any tesseract.js or worker_threads entries
- Cold starts on `createPaymentOrder` should be <5s (was previously impossible due to handler_unavailable)