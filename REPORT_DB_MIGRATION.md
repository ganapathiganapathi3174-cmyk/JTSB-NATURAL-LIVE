# Database Migration Report — Phase 6 (Jul 31, 2026)

## Migration File

| File | Purpose |
|------|---------|
| `migration-phase6.sql` | Idempotent DDL to fix live DB schema drift |

## Live DB Drift Discovered

Verified via live queries against Supabase REST API (`supabase.co/rest/v1/...` using service key).

### Columns Present in Canonical Schema BUT Missing in Live DB (9 total)

| Table | Column | Type (canonical) | Live Status |
|-------|--------|-------------------|-------------|
| `notifications` | `receiverId` | text | **MISSING** |
| `notifications` | `createdAt` | timestamptz | **MISSING** |
| `payment_sessions` | `paymentId` | text | **MISSING** |
| `payment_sessions` | `ocr_result` | jsonb | **MISSING** |
| `upi_payments` | `fraud_score` | numeric(5,2) | **MISSING** |
| `users` | `topup_referral_qualified_count` | integer | **MISSING** |
| `verification_logs` | `checks` | jsonb | **MISSING** |

### Code-Needed Columns NOT in Any Schema File (3 total — added to migration)

| Table | Column | Type | Why Needed |
|-------|--------|------|------------|
| `upi_payments` | `pipeline_session` | text | V7 pipeline tracks which session processed this payment |
| `users` | `topup_referral_qualified_count` | integer (default 0) | Used in companion topup flow for qualification tracking |
| `verification_logs` | `checks` | jsonb (default '{}') | V7 engine stores per-phase check results |

### Tables Present in Canonical Schema BUT Missing in Live DB (2 total)

| Table | Purpose |
|-------|---------|
| `sponsor_claims` | Sponsor bonus claim workflow (used by sponsorClaim.js) |
| `audit_logs` | Admin action audit trail (CRITICAL — all audit writes silently failed) |

### Notes

- `payment_sessions.paymentId` is in canonical schema but live DB is missing it; the `createPaymentOrder` handler stores `paymentId` in `payment_sessions` during V7 processing when the payment order UUID is known.
- `audit_logs` missing means ALL audit trail writes (`addDoc('audit_logs', ...)`) silently fail with 404 via PostgREST. This impacts sponsor actions, companion approvals, and admin actions — zero audit trail for security-sensitive operations.

## Migration SQL Details

### Idempotency

All statements use `if not exists` / `create table if not exists` patterns. Safe to run multiple times without error.

### RLS

All new tables have RLS enabled (`alter table ... enable row level security`). Existing exposed tables (`upi_payments`, `notifications`, etc.) already have RLS enabled.

### Indexes Created

- `idx_notifications_receiver` on `notifications(receiverId)`
- `idx_sponsor_claims_sponsor` on `sponsor_claims(sponsor_id)`
- `idx_sponsor_claims_status` on `sponsor_claims(status)`
- `idx_audit_logs_action` on `audit_logs(action)`
- `idx_audit_logs_target` on `audit_logs(target_id, target_type)`
- `idx_audit_logs_admin` on `audit_logs(admin_id)`
- `idx_audit_logs_created` on `audit_logs(created_at)`

## Application to Staging

This migration targets the **staging Supabase DB** (project `gaqxnvqxgzcvbrpigiad.supabase.co`). It should be applied via:

1. **Recommended**: Supabase SQL Editor (`https://supabase.com/dashboard/project/gaqxnvqxgzcvbrpigiad/sql`)
2. **Alternative**: Provide `SUPABASE_DB_URL` env var (Postgres connection string with admin role) to run via `pg` node module

### Pre-Apply Checklist

- [ ] Backup current live DB state (`pg_dump` or Supabase point-in-time recovery)
- [ ] Review migration-phase6.sql for table conflicts
- [ ] Apply to staging first, verify no errors
- [ ] Verify columns exist via `information_schema.columns` queries
- [ ] Verify audit_logs table accessible via REST (`GET /rest/v1/audit_logs?select=*&limit=1` returns 200)
- [ ] Re-run E2E (75/75) to confirm no regression
- [ ] Apply to production after staging validation passes

### Post-Apply Verification Queries

```sql
-- Verify notifications columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'notifications' AND column_name IN ('receiverId', 'createdAt');

-- Verify payment_sessions columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'payment_sessions' AND column_name IN ('paymentId', 'ocr_result');

-- Verify upi_payments columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'upi_payments' AND column_name IN ('fraud_score', 'pipeline_session');

-- Verify users columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'topup_referral_qualified_count';

-- Verify verification_logs columns
SELECT column_name FROM information_schema.columns WHERE table_name = 'verification_logs' AND column_name = 'checks';

-- Verify audit_logs accessible
SELECT count(*) FROM audit_logs LIMIT 1;

-- Verify sponsor_claims accessible
SELECT count(*) FROM sponsor_claims LIMIT 1;
```