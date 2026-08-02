# LIVE SCHEMA AUDIT FINDINGS (Aug 01, 2026)

**Scope:** Supabase project `gaqxnvqxgzcvbrpigiad` — schema vs the code written by the
6 payment-pipeline files + transitive helpers (`_approvalPipeline`, `_cycleEngine`,
`_notificationService`, `_auditLogger`, `_paymentOrderManager`, `_newEngine`).

**Method:** (1) authoritative OpenAPI spec (`/rest/v1/` swagger), (2) 170-column read
probe via service key, (3) **live write-probe** — temp rows INSERT → PATCH the exact
columns the code writes → DELETE. No residue (verified).

## RESULT: 13 schema gaps — 11 CRITICAL, 1 HIGH, plus degraded (stripped) columns

### Confirmed live write-failures (CRITICAL — payment pipeline broken)

| # | Table.column | Probe | Written by | Impact |
|---|--------------|-------|-----------|--------|
| 1 | `upi_payments.fraud_score` | **42703** | `processPendingPayments.js:22`, `_paymentOrderManager.js:279,297`, `_approvalPipeline.js:67` | **WHOLE updateDoc fails** → upi_payments never becomes `verified` |
| 2 | `upi_payments.risk_score` | **42703** | same files | same |
| 3 | `upi_payments.utr_hash` | **42703** | same + `_newEngine/duplicateChecker.js:33` | same + duplicate detection uses fallback scan |
| 4 | `upi_payments.verified_by` | **42703** | `_approvalPipeline.js:267` (admin claim) | admin approve claim dies → `claimed=0` |
| 5 | `audit_logs` (TABLE) | **404 missing** | `_approvalPipeline.js:154,168,244`, `_auditLogger.js`, `_smsEngine.js`, `_paymentConfirm.js`, `_upiPaymentMonitor.js` | every audit write silently fails |
| 6 | `notifications.receiverId` | **42703** | `_approvalPipeline.js:151,164,240`, `_notificationService.js`, `_cycleEngine.js`, `_otpManager.js`, `_smsEngine.js`, `_paymentConfirm.js` | every notification insert fails |
| 7 | `notifications.createdAt` | **42703** | same | same |
| 8 | `notifications.senderId` | **42703** | same | same |
| 9 | `notifications.senderName` | **42703** | same | same |
| 10 | `users.topup_referral_qualified_count` | **missing** | `_approvalPipeline.js:216`, `_paymentConfirm.js:317`, `_smsEngine.js:357` | topup referral qualification update silently fails |
| 11 | `topup_referral_income.updated_at` | **missing** | `_approvalPipeline.js:233`, `_cycleEngine.js:162` (via `updateDoc`, which auto-appends `updated_at`) | `status:'eligible'` unlock silently fails |

### HIGH — silent link-write failure (fallback covers it)

| # | Table.column | Probe | Written by | Impact |
|---|--------------|-------|-----------|--------|
| 12 | `payment_sessions.paymentId` (camelCase) | **42703** | `_paymentOrderManager.js:135` | order→upi_payments link never saved (live column is lowercase `paymentid`); code falls back to search-by-pending_reg_id/user_id — works, link degraded |

### Degraded — columns stripped by `updateDocFiltered`/`addDocFiltered`, writes survive

- `payment_sessions.screenshot_phash / verification_attempts / next_retry_at / last_error`
- `upi_payments.screenshot_phash / verification_attempts / next_retry_at / last_error`
- `verification_logs` 12 optional columns (`confidence`, `reasons`, `matched_fields`,
  `extracted_fields`, `checks`, `fraud_score`, `fraud_flags`, `ocr_engines`,
  `duplicate_check`, `decision_factors`, `stages`, `duration_ms`)

These are in the `HARDENING_COLS`/auditLogger optional lists → silently stripped.
Verification still writes, but retry bookkeeping + rich audit detail are disabled until
migration 0003/0004 columns exist.

### False positives (reclassified — NOT real gaps)

- `wallet_balances.user_id` — code addresses wallets by `id` (= userId), never `user_id`.
- `payment_sessions.upi_id` — no write target; `upi_id` writes go to `upi_payments` (exists).
- `verification_logs.confidence` etc. — write path is `addDocFiltered` → stripped, not fatal.

## Root-cause chain (why payments stuck / no auto-verify result persisted)

```
processPendingPayments.js:20  updateDoc(upi_payments, { ...fraud_score, risk_score, utr_hash })
                                    │  └─ fraud_score/risk_score/utr_hash MISSING on live
                                    ▼
                        PostgREST PATCH → 42703 (whole update rejected)
                                    │
                     updateDoc() catches internally → queues → returns true (silent)
                                    ▼
              upi_payments.status NEVER updated → admin "Process Pending" shows processed
              but rows stay 'pending' forever; auto-verification result never persisted.

Similarly: approveUPIPayment → _approvalPipeline.claim → verified_by → 42703 → claimed=0.
Every notification (receiverId/...) → 42703. Every audit_logs write → 404. All silent.
```

## Migration coverage

`scripts/0004-verification-migration-fix.sql` fixes **all 12** critical/high gaps
(fraud_score, risk_score, utr_hash, verified_by, audit_logs table, notifications
camelCase columns, users.topup_referral_qualified_count, wallet user_id, verification_logs
12 columns, + HARDENING columns). Exception: **`topup_referral_income.updated_at` is NOT
in 0004** — add it. Idempotent (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`).

## Blocker

Migration cannot be applied from this machine — no `postgres://` URL, no management token
(`api.supabase.com` → 401), no `exec_sql` RPC (404), no supabase CLI/psql/vercel. Requires
the Supabase project owner: **Dashboard → SQL Editor → paste 0004 SQL** (or provide a
connection URL / PAT).
