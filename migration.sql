-- ============================================================
-- CYCLE MANAGEMENT SYSTEM — Migration
-- Non-destructive: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS
-- Safe to run multiple times
-- ============================================================

-- ==================== NEW USER FIELDS ====================

-- Referral Cycle Tracking
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_cycle_number integer DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS current_cycle_referral_count integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS total_referrals integer DEFAULT 0;

-- Topup Cycle Tracking
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS topup_cycle_number integer DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS topup_status text DEFAULT 'active';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sponsor_topup_pending boolean DEFAULT false;

-- Lifecycle Timestamps
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS inactive_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reactivated_at timestamptz;

-- Backfill total_referrals from existing referrals_count (only for users who have been inactive/reactivated)
-- total_referrals should equal the max referrals_count ever reached for the user
-- Since we don't have historical data, use referrals_count as starting point
UPDATE public.users
SET total_referrals = GREATEST(referrals_count, total_referral_count, 0)
WHERE total_referrals = 0 AND (referrals_count > 0 OR total_referral_count > 0);

-- ==================== CYCLE HISTORY TABLE ====================

CREATE TABLE IF NOT EXISTS public.cycle_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  cycle_type text NOT NULL,
  cycle_number integer NOT NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  admin_id text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cycle_history_user ON public.cycle_history(user_id);
CREATE INDEX IF NOT EXISTS idx_cycle_history_type ON public.cycle_history(cycle_type);
CREATE INDEX IF NOT EXISTS idx_cycle_history_action ON public.cycle_history(action);
CREATE INDEX IF NOT EXISTS idx_cycle_history_created ON public.cycle_history(created_at);

-- ==================== RLS ====================

ALTER TABLE public.cycle_history ENABLE ROW LEVEL SECURITY;

-- ==================== INDEXES FOR NEW FIELDS ====================

CREATE INDEX IF NOT EXISTS idx_users_referral_cycle ON public.users(referral_cycle_number);
CREATE INDEX IF NOT EXISTS idx_users_inactive_reason ON public.users(inactive_reason);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON public.users(account_status);
