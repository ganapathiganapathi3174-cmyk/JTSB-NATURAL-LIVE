-- ============================================================
-- JSREE APEX — Phase 5 Migration (2026-07)
-- Adds columns/tables required by the hardened verification pipeline.
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── 1. upi_payments: add utr_hash + risk_score ──
-- utr_hash: SHA-256 (uppercased UTR) — powers cross-request duplicate detection.
-- risk_score: composite fraud/evidence risk 0-100.
alter table if exists public.upi_payments
  add column if not exists utr_hash text,
  add column if not exists risk_score numeric(5,2);

create index if not exists idx_upi_utr_hash on public.upi_payments(utr_hash);
create index if not exists idx_upi_screenshot_hash on public.upi_payments(screenshot_hash);
create index if not exists idx_upi_pending_reg_id on public.upi_payments(pending_reg_id);
create index if not exists idx_upi_created_at on public.upi_payments(created_at);

-- ── 2. payment_sessions: add hash columns for the order-mgr pipeline ──
alter table if exists public.payment_sessions
  add column if not exists utr_hash text,
  add column if not exists screenshot_hash text,
  add column if not exists fraud_score numeric(5,2),
  add column if not exists risk_score numeric(5,2),
  add column if not exists verification_locked boolean default false,
  add column if not exists verification_locked_at timestamptz;

create index if not exists idx_sessions_utr_hash on public.payment_sessions(utr_hash);
create index if not exists idx_sessions_screenshot_hash on public.payment_sessions(screenshot_hash);
create index if not exists idx_sessions_status on public.payment_sessions(status);

-- ── 3. payment_confirm_sessions table (used by _paymentConfirm.js) ──
create table if not exists public.payment_confirm_sessions (
  id uuid primary key default uuid_generate_v4(),
  type text,
  plan text,
  amount numeric(12,2),
  status text default 'pending',
  transactionReference text,
  transactionTime timestamptz,
  createdAt timestamptz default now(),
  expiresAt timestamptz,
  approvedAt timestamptz,
  pendingRegId uuid references public.pending_registrations(id) on delete set null,
  userId uuid references public.users(id) on delete set null,
  metadata jsonb,
  approvalError text
);

create index if not exists idx_pcs_status on public.payment_confirm_sessions(status);
create index if not exists idx_pcs_amount on public.payment_confirm_sessions(amount);
create index if not exists idx_pcs_ref on public.payment_confirm_sessions(transactionReference);

-- ============================================================
-- Optional: canonical inactive_reason backfill for old rows.
-- Uncomment after confirming the cycle-engine strings in production.
-- ============================================================
-- update public.users set inactive_reason = 'REFERRAL_LIMIT_COMPLETED'
--   where inactive_reason = 'Referral Limit Reached (2 Successful Referrals)';
