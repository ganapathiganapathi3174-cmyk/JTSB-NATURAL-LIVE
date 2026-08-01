-- ============================================================
-- 0003 — Production Hardening: retry bookkeeping + pHash columns
--
-- Adds the columns consumed by the verification hardening layer:
--   * screenshot_phash      — perceptual hash (dHash) for near-duplicate
--                             screenshot detection (SHA-256 only catches
--                             byte-identical copies; re-encoded screenshots
--                             have different SHA-256 but near-identical pHash).
--   * verification_attempts — persistent retry counter (exhausted when it
--                             reaches VERIFY_MAX_ATTEMPTS, default 3).
--   * next_retry_at         — DB-backed retry schedule (worker-safe: each
--                             serverless instance reads/writes this column
--                             instead of relying on in-memory timers).
--   * last_error            — last transient failure message for dashboards.
--
-- Safe to run repeatedly (ADD COLUMN IF NOT EXISTS).
-- Run in Supabase SQL Editor.
-- ============================================================

-- payment_sessions (order table — canonical session)
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "screenshot_phash" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_attempts" integer DEFAULT 0;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "last_error" text;

-- upi_payments (canonical payment record)
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "screenshot_phash" text;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "verification_attempts" integer DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "last_error" text;

-- indexes for retry scanning (most-recent-first) and phash dedup
CREATE INDEX IF NOT EXISTS idx_upi_screenshot_phash ON public.upi_payments(screenshot_phash);
CREATE INDEX IF NOT EXISTS idx_sessions_next_retry ON public.payment_sessions(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sessions_verification_attempts ON public.payment_sessions(verification_attempts);
