-- ============================================================
-- 0004 — Verification Pipeline Schema Completeness
--
-- WHY: Production was stuck with verificationStatus=pending,
-- verificationScore=0, checks=[], verificationAttempts=0 even
-- after successful screenshot upload. Root cause:
--
--   1. handlers/submitPaymentProof.js writes `utr` and
--      `expected_upi_id` to payment_sessions. Those columns exist
--      ONLY in migration 0002 (NOT in the base supabase-schema).
--      When 0002 is missing in the live DB, the whole UPDATE dies
--      with 42703, so `screenshot_url` never persists and the
--      status poll never triggers verification.
--
--   2. The verification success-path (api/_paymentOrderManager.js)
--      writes screenshot_phash / verification_attempts /
--      next_retry_at / last_error. Those columns exist ONLY in
--      migration 0003. When 0003 is missing, the result-save
--      UPDATE dies with 42703 and the payment stays pending.
--
--   3. api/_newEngine/auditLogger.js writes 12 columns to
--      verification_logs that the base schema does not define
--      (confidence, reasons, matched_fields, extracted_fields,
--      checks, fraud_score, fraud_flags, ocr_engines,
--      duplicate_check, decision_factors, stages, duration_ms) —
--      so every audit INSERT also failed silently.
--
--   4. Live-schema probe (2026-08-01, PostgREST select=<col> via
--      service key) found 35 MISSING columns/tables that the app
--      code writes UNCONDITIONALLY (not in the HARDENING_COLS
--      strip list), so every upi_payments update died with 42703
--      and payments stayed status='pending' forever:
--        * upi_payments.fraud_score / risk_score / utr_hash
--          (written by processPendingPayments.js + paymentOrderManager)
--        * upi_payments.verified_by (approvalPipeline admin claim)
--        * users.topup_referral_qualified_count (topup approval)
--        * verification_logs: 12 columns (audit inserts)
--        * notifications.receiverId/createdAt/senderId/senderName
--        * audit_logs table entirely missing (all audit writes fail)
--      Sections 2/3/4/5b below close every one of these gaps.
--
-- This migration makes the schema match what the code writes.
-- NON-DESTRUCTIVE: only ADD COLUMN IF NOT EXISTS / CREATE TABLE
-- IF NOT EXISTS / CREATE INDEX IF NOT EXISTS. No DROP, no DELETE,
-- no TRUNCATE, no data loss. Safe to run repeatedly.
--
-- Run in Supabase SQL Editor (or `psql`).
-- ============================================================

-- ============================================================
-- 1) payment_sessions — the canonical order/session table
-- ============================================================

-- Columns written by handlers/submitPaymentProof.js (migration 0002
-- introduced these; the base schema only had utr_hash / screenshot_hash).
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "utr" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expected_amount" numeric;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expected_upi_id" text;

-- Columns written by the verification success-path (migration 0003):
-- retry bookkeeping + perceptual hash.
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "screenshot_phash" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_attempts" integer DEFAULT 0;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "last_error" text;

-- ============================================================
-- 2) upi_payments — the canonical payment record
-- ============================================================

-- Columns written by api/_paymentOrderManager.js success-path
-- (migration 0003 hardening columns).
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "screenshot_phash" text;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "verification_attempts" integer DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "last_error" text;

-- Columns written UNCONDITIONALLY (NOT in the HARDENING_COLS strip list) by
-- handlers/processPendingPayments.js and api/_paymentOrderManager.js:
--   fraud_score / risk_score / utr_hash / verified_by.
-- If these are missing, the ENTIRE updateDoc/updateDocFiltered on upi_payments
-- fails with 42703 and the payment stays stuck in status='pending'.
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "fraud_score" numeric(5,2) DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "risk_score" numeric(5,2) DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "utr_hash" text;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "verified_by" text;

-- ============================================================
-- 3) verification_logs — audit records written by
--    api/_newEngine/auditLogger.js (now via addDocFiltered)
-- ============================================================
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "confidence" numeric;
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "reasons" jsonb DEFAULT '[]';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "matched_fields" jsonb DEFAULT '{}';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "extracted_fields" jsonb DEFAULT '{}';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "checks" jsonb DEFAULT '{}';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "fraud_score" numeric(5,2) DEFAULT 0;
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "fraud_flags" jsonb DEFAULT '[]';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "ocr_engines" integer DEFAULT 0;
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "duplicate_check" text;
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "decision_factors" jsonb DEFAULT '{}';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "stages" jsonb DEFAULT '{}';
ALTER TABLE public.verification_logs ADD COLUMN IF NOT EXISTS "duration_ms" bigint DEFAULT 0;

-- ============================================================
-- 4) notifications — ensure the exact columns written by
--    api/_notificationService.js + api/_approvalPipeline.js exist
--    (receiverId / title / status / senderId / senderName /
--    createdAt were missing at one point — make them idempotent).
-- ============================================================
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "receiverId" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "senderId" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "senderName" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "message" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "type" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'unread';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "is_read" boolean DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "readAt" timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "createdAt" timestamptz DEFAULT now();

-- ============================================================
-- 5b) users — columns written by api/_approvalPipeline.js topup
--     referral-qualification path (unconditional updateDoc).
--     Missing => topup approval dies at 42703 before wallet credit.
-- ============================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "topup_referral_qualified_count" integer DEFAULT 0;

-- ============================================================
-- 5c) wallet_balances — optional user_id column for consistency with
--     the rest of the schema (writes key by id; harmless to add).
-- ============================================================
ALTER TABLE public.wallet_balances ADD COLUMN IF NOT EXISTS "user_id" text;

-- ============================================================
-- 5d) topup_referral_income — updateDoc() unconditionally appends
--     `updated_at` to every PATCH. Without this column the
--     `status:'eligible'` unlock (approvalPipeline:233 / cycleEngine:162)
--     fails with 42703 and the sponsor-topup unlock silently never
--     persists. Verified missing on live (2026-08-01 probe).
-- ============================================================
ALTER TABLE public.topup_referral_income ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;

-- ============================================================
-- 6) audit_logs — ensure the table exists with the exact columns
--    written by api/_auditLogger.js + api/_approvalPipeline.js.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  action text,
  target_id text,
  target_type text,
  admin_id text,
  details jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- 6) Indexes for the verification/retry path
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_upi_screenshot_phash ON public.upi_payments(screenshot_phash);
CREATE INDEX IF NOT EXISTS idx_sessions_next_retry ON public.payment_sessions(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sessions_verification_attempts ON public.payment_sessions(verification_attempts);
CREATE INDEX IF NOT EXISTS idx_sessions_utr ON public.payment_sessions(utr);
CREATE INDEX IF NOT EXISTS idx_sessions_expected_upi ON public.payment_sessions(expected_upi_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_payment ON public.verification_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_receiver ON public.notifications(receiverId);

-- ============================================================
-- VERIFICATION (run these AFTER the migration in the SQL Editor):
--
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='payment_sessions'
--     and column_name in ('utr','expected_upi_id','screenshot_phash',
--       'verification_attempts','next_retry_at','last_error');
--
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='verification_logs'
--     and column_name in ('confidence','checks','fraud_score',
--       'duplicate_check','stages','duration_ms');
-- ============================================================
