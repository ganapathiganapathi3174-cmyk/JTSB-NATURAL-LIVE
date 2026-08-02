# DEPLOYMENT REPORT — Live Supabase Schema Sync

**Date:** 2026-08-01
**Supabase project:** `https://gaqxnvqxgzcvbrpigiad.supabase.co`
**Scope:** Registration payment + Topup payment must auto-verify, persist the full
verification result, and never remain stuck at `status='pending'`.
**Objective honored:** NO new verification logic was created. This is a schema-sync
operation only.

---

## 1. Missing Schema Found (baseline probe)

Probe method: read-only PostgREST `GET /rest/v1/<table>?select=<column>&limit=1`
via service key. `42703`/`does not exist` => column missing; `PGRST205` =>
table missing. Baseline captured by `scripts/validate-live-schema.js`:

- 12 tables, 162 columns probed.
- **34 missing columns/tables** (all now covered by the migration).

### payment_sessions (4 missing)
| Column | Written by | Effect when missing |
|---|---|---|
| `screenshot_phash` | `_paymentOrderManager.js` success path | stripped (HARDENING_COLS) — degrades, but blocks phash dedup |
| `verification_attempts` | `_verifyQueue.js` | stripped (HARDENING_COLS) — retry bookkeeping lost |
| `next_retry_at` | `_verifyQueue.js` | stripped (HARDENING_COLS) — retry policy broken |
| `last_error` | `_verifyQueue.js` | stripped (HARDENING_COLS) — error detail lost |

### upi_payments (5 missing) — CRITICAL
| Column | Written by | Effect when missing |
|---|---|---|
| `fraud_score` | `processPendingPayments.js:22`, `_paymentOrderManager.js:279` | **UNCONDITIONAL write → 42703 → entire update dies → payment stays `pending`** |
| `risk_score` | same | same |
| `utr_hash` | same | same — duplicate-UTR lookup also fails (falls back to scan) |
| `screenshot_phash` | `_paymentOrderManager.js:281` | phash dedup disabled |
| `verified_by` | `_approvalPipeline.js:267` admin claim | admin approve claim update dies |

### verification_logs (12 missing)
`confidence`, `reasons`, `matched_fields`, `extracted_fields`, `checks`,
`fraud_score`, `fraud_flags`, `ocr_engines`, `duplicate_check`,
`decision_factors`, `stages`, `duration_ms`.
All written by `api/_newEngine/auditLogger.js` (now via `addDocFiltered`, so the
INSERT survives by stripping until migration is applied — but the audit record is
then incomplete).

### notifications (4 missing)
`receiverId`, `createdAt`, `senderId`, `senderName`.
Written by `_notificationService.js` + `_approvalPipeline.js`. Missing →
**every notification INSERT fails** (all are try/catch-wrapped, so silently lost).

### audit_logs — TABLE ENTIRELY MISSING (7 columns)
`id`, `action`, `target_id`, `target_type`, `admin_id`, `details`, `created_at`.
Written by `_auditLogger.js` + `_approvalPipeline.js` + `_cycleEngine.js`. Missing →
**every audit write fails silently** (all are try/catch-wrapped).

### users (1 missing)
`topup_referral_qualified_count` — written unconditionally in
`_approvalPipeline.js:216`. Missing → topup approval update dies at 42703.

### wallet_balances (1 missing)
`user_id` — added for schema consistency (code keys by `id`, non-blocking).

### Already present (verified OK — no action needed)
`payment_sessions.utr / expected_amount / expected_upi_id / verification_status /
verification_score / screenshot_url / ocr_result / rejection_reasons`,
`upi_payments.ocr_result / final_score / screenshot_hash / rejection_reasons /
verified_at / verification_locked / verification_completed_at`,
`verification_logs.ocr_confidence`,
`notifications.title / message / type / status`,
all cycle-engine columns + `cycle_history` table,
all `users` wallet/referral/sponsor columns except the one above.

> Note: `payment_sessions.orderId` probe returned MISSING but is a false positive —
> orders are inserted with `id: orderId`; no code writes/queries a separate
> `orderId` column. Not required.

---

## 2. SQL Executed

**Status:** ⏳ READY — **must be run by an operator** (no direct Postgres /
management-token access from this machine; PostgREST cannot run DDL).

**Single migration file:** `scripts/0004-verification-migration-fix.sql`

Fully idempotent and NON-DESTRUCTIVE:
- Only `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`.
- No DROP, no DELETE, no TRUNCATE, no data loss. Safe to run repeatedly.
- Preserves every existing row.

Covers all 34 gaps: payment_sessions (4) + upi_payments hardening (4) +
**upi_payments unconditional-write columns (fraud_score/risk_score/utr_hash/
verified_by)** + verification_logs (12) + notifications (4) + audit_logs table +
users.topup_referral_qualified_count + wallet_balances.user_id + 7 indexes.

**Run instructions (Supabase Dashboard → SQL Editor, or `psql`):**
1. Open `scripts/0004-verification-migration-fix.sql`.
2. Paste into the SQL Editor and Run.
3. Re-run validation:
   `node scripts/validate-live-schema.js --expect-clean`
   Expected: `RESULT: PASS`.

---

## 3. Validation

### Baseline (pre-migration) — executed 2026-08-01 09:16
`node scripts/validate-live-schema.js`
→ **34 schema gaps captured** (documented above). Exit code 1 (expected).

### Code inventory — executed (all queries verified against target schema)
All 7 flows verified against the post-migration target schema — no query
references a column that the migration does not create:
- `preRegister` → `users`, `pending_registrations`
- `createPaymentOrder` → `payment_sessions`, `upi_payments`
- `submitPaymentProof` → `payment_sessions` (via `updateDocFiltered`)
- `getPaymentOrderStatus` → `payment_sessions`
- `approveUPIPayment` → `upi_payments`, `payment_sessions`, `_approvalPipeline`
- `processPendingPayments` → `upi_payments`, `_approvalPipeline`
- topup → `createTopupSessionHttp` + `createPaymentOrder` (type=topup) +
  `_approvalPipeline` topup branch

**Decision: no query needs to be changed.** The 4 HARDENING_COLS strips
(`screenshot_phash`, `verification_attempts`, `next_retry_at`, `last_error`) were
added as a *graceful-degradation* layer and become no-ops once the migration is
applied. The 5 unconditional-write columns (the root cause of stuck-`pending`
payments) are now created by the migration, so nothing is stripped and no 42703
can abort an update.

### Post-migration (to be executed by operator)
`node scripts/validate-live-schema.js --expect-clean`
Expected: 0 missing → `RESULT: PASS` → exit 0.

---

## 4. Remaining Issues

| # | Severity | Issue | Action |
|---|---|---|---|
| 1 | **BLOCKER** | Migration not yet applied to live DB | Run `scripts/0004-verification-migration-fix.sql` in Supabase SQL Editor, then re-run validation `--expect-clean` |
| 2 | BLOCKER | No direct Postgres/management-token access from this machine | Operator action required (or provide a `postgres://` URL / service-role token so automation can apply + validate) |
| 3 | LOW | `payment_sessions.orderId` flagged missing (false positive — no code dependency) | None |
| 4 | LOW | `wallet_balances.user_id` added for consistency only | None |
| 5 | INFO | Pre-migration, the 4 HARDENING_COLS + 12 verification_logs columns are stripped by the resilience layer; partial data until migration | After migration, re-verify + re-submit any stuck payments via "Process Pending" |
| 6 | INFO | Deploy `starlightascent.vercel.app` blocked on `vercel login` | `vercel login` (or token) then redeploy; prod E2E with `e2e_live_verify.js` |

---

## Bottom Line

Root cause was **not** missing logic — it was the **live schema being behind the
codebase**: unconditional writes to 5 non-existent `upi_payments` columns
(`fraud_score`/`risk_score`/`utr_hash`/`verified_by`, plus `screenshot_phash`)
made every verification-result update fail with 42703, so payments stayed
`pending` forever. After `scripts/0004-verification-migration-fix.sql` is applied
(and validated with `--expect-clean`), registration and topup payments will
auto-verify and persist `verification_score`, `verification_status`, `checks`,
matched flags, `fraud_score`, `verification_attempts`, `screenshot_phash`,
`last_error`, `next_retry_at` — and the local E2E already confirms the
pipeline reaches `manual_review`@90 (auto-approve requires OCR ≥98%) end-to-end.
