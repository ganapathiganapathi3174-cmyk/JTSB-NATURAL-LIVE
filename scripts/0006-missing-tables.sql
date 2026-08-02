-- ============================================================
-- 0006: CREATE MISSING TABLES
--   upgrade_requests
--   sponsor_transfers
--   payment_ai_logs
--
-- Verified MISSING in the live Supabase database (REST probe:
-- PGRST205 "Could not find the table" for all three).
-- These tables are referenced by production handlers and admin
-- frontend pages but were never applied to the live DB.
--
-- 100% IDEMPOTENT: safe to run repeatedly.
--   CREATE TABLE IF NOT EXISTS
--   CREATE INDEX IF NOT EXISTS
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS (safety net)
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY (idempotent)
--   CREATE POLICY IF NOT EXISTS (idempotent)
--   CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS (idempotent)
-- TRANSACTION-SAFE: wrapped in BEGIN/COMMIT, no destructive ops.
--
-- FK DESIGN (documented deviations from migration.sql):
--   upgrade_requests.user_id       ON DELETE CASCADE   (user gone -> requests gone)
--   sponsor_transfers.user_id      ON DELETE CASCADE   (user gone -> transfers gone)
--   sponsor_transfers.new_sponsor_id ON DELETE CASCADE (sponsor gone -> pending requests to them gone)
--   sponsor_transfers.old_sponsor_id ON DELETE SET NULL (DEV: migration.sql omits this clause,
--      i.e. RESTRICT. adminDeleteRecord/permanentDeleteUser only delete transfers by user_id,
--      so RESTRICT would block deleting any user who appears as old_sponsor_id in history.
--      SET NULL preserves the historical record while un-linking the deleted user.)
--
-- Run this ONCE in the Supabase SQL Editor.
-- ============================================================

BEGIN;

-- -------------------- UPGRADE REQUESTS --------------------
CREATE TABLE IF NOT EXISTS public.upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  user_name text,
  user_email text,
  user_phone text,
  current_plan text,
  requested_plan text NOT NULL,
  amount numeric(12,2) NOT NULL,
  referral_code text,
  status text DEFAULT 'pending',
  admin_id text,
  rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Safety net: ensure every column the handlers reference exists.
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS user_name text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS user_phone text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS current_plan text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS requested_plan text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS admin_id text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.upgrade_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_upgrade_req_user ON public.upgrade_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_upgrade_req_status ON public.upgrade_requests(status);
CREATE INDEX IF NOT EXISTS idx_upgrade_req_created ON public.upgrade_requests(created_at);
-- Composite index for the common "user_id + status" filter (duplicate-pending check).
CREATE INDEX IF NOT EXISTS idx_upgrade_req_user_status ON public.upgrade_requests(user_id, status);

ALTER TABLE public.upgrade_requests ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS, but grant a full policy so any future
-- anon/authenticated PostgREST access to this table is permitted by default.
CREATE POLICY IF NOT EXISTS "service_role_all_upgrade_requests"
  ON public.upgrade_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -------------------- SPONSOR TRANSFERS --------------------
CREATE TABLE IF NOT EXISTS public.sponsor_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  old_sponsor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  old_sponsor_code text,
  new_sponsor_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  new_sponsor_code text,
  user_plan numeric(12,2),
  status text DEFAULT 'pending',
  requested_at timestamptz DEFAULT now(),
  responded_at timestamptz,
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Safety net: ensure every column the handlers reference exists.
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS old_sponsor_id uuid;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS old_sponsor_code text;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS new_sponsor_id uuid;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS new_sponsor_code text;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS user_plan numeric(12,2);
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS requested_at timestamptz DEFAULT now();
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS responded_at timestamptz;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.sponsor_transfers ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_user ON public.sponsor_transfers (user_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_new_sponsor ON public.sponsor_transfers (new_sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_status ON public.sponsor_transfers (status);
-- Indexes for cascade-delete queries (deleteByField on old/new sponsor) and
-- the "pending transfer to this sponsor" filter used by the marketplace.
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_old_sponsor ON public.sponsor_transfers (old_sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_user_status ON public.sponsor_transfers (user_id, status);
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_created ON public.sponsor_transfers (created_at);

ALTER TABLE public.sponsor_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_role_all_sponsor_transfers"
  ON public.sponsor_transfers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -------------------- PAYMENT AI LOGS --------------------
CREATE TABLE IF NOT EXISTS public.payment_ai_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id text,
  user_id text,
  utr text,
  image_score numeric(5,2),
  vision_score numeric(5,2),
  paddle_confidence numeric(5,2),
  easyocr_confidence numeric(5,2),
  tesseract_confidence numeric(5,2),
  voted_amount text,
  voted_utr text,
  voted_upi text,
  voted_date text,
  voted_time text,
  voted_status text,
  fraud_score numeric(5,2),
  fraud_flags jsonb DEFAULT '[]',
  final_decision text,
  confidence numeric(5,2),
  reasons jsonb DEFAULT '[]',
  matched_fields jsonb DEFAULT '{}',
  processing_time_ms integer,
  ai_model_used text,
  created_at timestamptz DEFAULT now()
);

-- Safety net: ensure every column the handlers reference exists.
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS payment_id text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS utr text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS image_score numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS vision_score numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS paddle_confidence numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS easyocr_confidence numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS tesseract_confidence numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS voted_amount text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS voted_utr text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS voted_upi text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS voted_date text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS voted_time text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS voted_status text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS fraud_score numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS fraud_flags jsonb;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS final_decision text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS confidence numeric(5,2);
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS reasons jsonb;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS matched_fields jsonb;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS processing_time_ms integer;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS ai_model_used text;
ALTER TABLE public.payment_ai_logs ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_payment_ai_logs_payment ON public.payment_ai_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_ai_logs_created ON public.payment_ai_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_ai_logs_user ON public.payment_ai_logs(user_id);

ALTER TABLE public.payment_ai_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_role_all_payment_ai_logs"
  ON public.payment_ai_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- -------------------- UPDATED_AT TRIGGERS --------------------
-- Handlers (approveUpgradeRequest / rejectUpgradeRequest / handleSponsorTransfer)
-- do not always set updated_at on update; keep it accurate for all tables that
-- expose it. payment_ai_logs has no updated_at column, so no trigger there.

CREATE OR REPLACE FUNCTION public.jsree_touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_upgrade_requests_updated_at ON public.upgrade_requests;
CREATE TRIGGER trg_upgrade_requests_updated_at
  BEFORE UPDATE ON public.upgrade_requests
  FOR EACH ROW EXECUTE FUNCTION public.jsree_touch_updated_at();

DROP TRIGGER IF EXISTS trg_sponsor_transfers_updated_at ON public.sponsor_transfers;
CREATE TRIGGER trg_sponsor_transfers_updated_at
  BEFORE UPDATE ON public.sponsor_transfers
  FOR EACH ROW EXECUTE FUNCTION public.jsree_touch_updated_at();

COMMIT;
