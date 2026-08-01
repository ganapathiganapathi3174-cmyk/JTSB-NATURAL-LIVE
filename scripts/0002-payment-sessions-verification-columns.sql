-- ============================================================
-- 0002 — Add missing verification columns to public.payment_sessions
--
-- ROOT CAUSE (2026-08-01): the live Supabase project's
-- payment_sessions table only had: amount, completedat, createdat,
-- expires_at, id, paymentid, status, type, user_id.
--
-- Every verification write to this table (screenshot_url,
-- verification_status, verification_score, ocr_result,
-- rejection_reasons, updated_at, ...) failed silently at the DB
-- level, so payment orders were stuck at 'pending' forever.
--
-- Run this in the Supabase SQL Editor (Project → SQL Editor → New query).
-- Safe to run repeatedly (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "pending_reg_id" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expected_amount" numeric;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expected_upi_id" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "utr" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_status" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_score" numeric(5,2);
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "screenshot_url" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "ocr_result" jsonb DEFAULT '{}';
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "rejection_reasons" jsonb DEFAULT '[]';
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "final_score" numeric(5,2);
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "utr_hash" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "screenshot_hash" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "fraud_score" numeric(5,2);
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "risk_score" numeric(5,2);
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_locked" boolean DEFAULT false;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_locked_at" timestamptz;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "customer_email" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now();
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sessions_utr_hash ON public.payment_sessions(utr_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_screenshot_hash ON public.payment_sessions(screenshot_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.payment_sessions(status);
