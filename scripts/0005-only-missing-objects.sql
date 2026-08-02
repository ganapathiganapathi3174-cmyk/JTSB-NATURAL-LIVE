ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "screenshot_phash" text;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "verification_attempts" integer DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "fraud_score" numeric(5,2) DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "risk_score" numeric(5,2) DEFAULT 0;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "utr_hash" text;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS "verified_by" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "pending_reg_id" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expected_amount" numeric;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expected_upi_id" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "utr" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "upi_id" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "paymentId" text;
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
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "screenshot_phash" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_attempts" integer DEFAULT 0;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "next_retry_at" timestamptz;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "last_error" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now();
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();
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
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "email_hash" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "phone_hash" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "referral_active" boolean DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "is_qualified" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "topup_referral_qualified_count" integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "topup_referral_qualified" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_awaiting_credit" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_topup_pending" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_topup_completed" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_cycle_completed" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_credited" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_credited_amount" numeric DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_credited_at" timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_credited_by" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_topup_id" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsor_topup_amount" numeric DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "inactive_reason" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "inactive_at" timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "reactivated_at" timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "referral_cycle_number" integer DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "current_cycle_referral_count" integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "total_referrals" integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "topup_cycle_number" integer DEFAULT 1;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "topup_status" text DEFAULT 'active';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "topup_referrals_count" integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "referral_view_count" integer DEFAULT 0;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "referral_created_at" timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "referral_expires_at" timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "sponsorId" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "inactiveReason" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "loginEnabled" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "membershipPaid" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "membershipStatus" text DEFAULT 'inactive';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "renewalRequired" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "reviewRequired" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "admin_status" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "rejected_by" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "rejected_at" timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "rejection_reason" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "status_change_history" jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "profile_picture_url" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "theme_color" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "is_first_payment_done" boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "utr_number" text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS "upi_screenshot_url" text;
ALTER TABLE public.wallet_balances ADD COLUMN IF NOT EXISTS "user_id" text;
ALTER TABLE public.topup_referral_income ADD COLUMN IF NOT EXISTS "updated_at" timestamptz;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS "reference_type" text;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS "balance_before" numeric(12,2) DEFAULT 0;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS "balance_after" numeric(12,2) DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text,
  target_id text,
  target_type text,
  admin_id text,
  details jsonb,
  created_at timestamptz default now()
);
CREATE TABLE IF NOT EXISTS public.cycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  cycle_type text NOT NULL,
  cycle_number integer NOT NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  admin_id text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.sponsor_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  claim_amount numeric(12,2) DEFAULT 0,
  items_count integer DEFAULT 0,
  items jsonb DEFAULT '[]',
  status text DEFAULT 'pending',
  claim_date timestamptz DEFAULT now(),
  approved_at timestamptz,
  approved_by text,
  rejected_at timestamptz,
  rejected_by text,
  rejection_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  referral_code text,
  referred_email text,
  referred_name text,
  referred_phone text,
  status text DEFAULT 'pending',
  reward_claimed boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.topup_referral_income (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  from_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  topup_id uuid REFERENCES public.topups(id) ON DELETE CASCADE,
  amount numeric(12,2),
  level integer DEFAULT 1,
  status text DEFAULT 'locked',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_upi_screenshot_phash ON public.upi_payments(screenshot_phash);
CREATE INDEX IF NOT EXISTS idx_sessions_utr_hash ON public.payment_sessions(utr_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_screenshot_hash ON public.payment_sessions(screenshot_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON public.payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_next_retry ON public.payment_sessions(next_retry_at);
CREATE INDEX IF NOT EXISTS idx_sessions_verification_attempts ON public.payment_sessions(verification_attempts);
CREATE INDEX IF NOT EXISTS idx_sessions_utr ON public.payment_sessions(utr);
CREATE INDEX IF NOT EXISTS idx_sessions_expected_upi ON public.payment_sessions(expected_upi_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_payment ON public.verification_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_notifications_receiver ON public.notifications("receiverId");
CREATE INDEX IF NOT EXISTS idx_users_referral_cycle ON public.users(referral_cycle_number);
CREATE INDEX IF NOT EXISTS idx_users_inactive_reason ON public.users(inactive_reason);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON public.audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_cycle_history_user ON public.cycle_history(user_id);
CREATE INDEX IF NOT EXISTS idx_cycle_history_type ON public.cycle_history(cycle_type);
CREATE INDEX IF NOT EXISTS idx_cycle_history_action ON public.cycle_history(action);
CREATE INDEX IF NOT EXISTS idx_cycle_history_created ON public.cycle_history(created_at);
CREATE INDEX IF NOT EXISTS idx_sponsor_claims_sponsor ON public.sponsor_claims(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_claims_status ON public.sponsor_claims(status);
CREATE INDEX IF NOT EXISTS idx_referrals_user ON public.referrals(user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_topup_income_user ON public.topup_referral_income(user_id);
CREATE INDEX IF NOT EXISTS idx_topup_income_from ON public.topup_referral_income(from_user_id);
