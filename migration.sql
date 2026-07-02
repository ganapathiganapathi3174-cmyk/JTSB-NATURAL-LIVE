-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  phone text,
  name text,
  password_hash text,
  password text,
  referral_code text UNIQUE,
  referred_by text,
  referred_by_status text DEFAULT 'pending',
  account_status text DEFAULT 'inactive',
  payment_status text DEFAULT 'pending',
  membership_type text DEFAULT 'basic',
  membership_paid boolean DEFAULT false,
  membershipPaid boolean DEFAULT false,
  active boolean DEFAULT false,
  approved boolean DEFAULT false,
  approved_date timestamptz,
  joined_date timestamptz,
  last_active_at timestamptz,
  referral_limit_reached boolean DEFAULT false,
  referrals_count integer DEFAULT 0,
  total_referral_count integer DEFAULT 0,
  sponsor_topup_completed boolean DEFAULT false,
  topup_referral_qualified boolean DEFAULT false,
  sponsor_credited boolean DEFAULT false,
  locked_income numeric(12,2) DEFAULT 0,
  activated_at timestamptz,
  activated_by text,
  activation_reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status text DEFAULT 'pending',
  membershipStatus text DEFAULT 'inactive',
  sponsorId text,
  sponsorRenewalRequired boolean DEFAULT false,
  reviewRequired boolean DEFAULT false,
  referral_active boolean DEFAULT true,
  referral_view_count integer DEFAULT 0,
  is_active boolean DEFAULT false,
  is_first_payment_done boolean DEFAULT false,
  referral_created_at timestamptz,
  referral_expires_at timestamptz,
  admin_status text,
  theme_color text,
  profile_picture_url text,
  status_change_history jsonb,
  rejected_by text,
  rejected_at timestamptz,
  rejection_reason text,
  renewalRequired boolean DEFAULT false,
  inactiveReason text,
  loginEnabled boolean DEFAULT false,
  is_qualified boolean,
  sponsor_credited_amount numeric DEFAULT 0,
  sponsor_credited_at timestamptz,
  sponsor_credited_by text,
  sponsor_awaiting_credit boolean DEFAULT false,
  sponsor_cycle_completed boolean DEFAULT false,
  sponsor_topup_id text,
  sponsor_topup_amount numeric DEFAULT 0,
  inactive_reason text,
  topup_referrals_count integer DEFAULT 0,
  utr_number text,
  upi_screenshot_url text
);

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users (phone);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users (referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON public.users (referred_by);
CREATE INDEX IF NOT EXISTS idx_users_account_status ON public.users (account_status);
CREATE INDEX IF NOT EXISTS idx_users_payment_status ON public.users (payment_status);

-- ============================================================
-- TABLE: uniques
-- ============================================================
CREATE TABLE IF NOT EXISTS public.uniques (
  id text PRIMARY KEY,
  field text,
  value text,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  claimed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: pending_registrations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pending_registrations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text,
  email text,
  phone text,
  password_hash text,
  referral_code text,
  utr text,
  amount numeric(12,2),
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_reg_email ON public.pending_registrations (email);
CREATE INDEX IF NOT EXISTS idx_pending_reg_status ON public.pending_registrations (status);

-- ============================================================
-- TABLE: upi_payments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.upi_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  pending_reg_id uuid REFERENCES public.pending_registrations(id) ON DELETE SET NULL,
  utr text,
  upi_id text,
  amount numeric(12,2),
  amount_option text,
  payment_type text,
  screenshot_url text,
  status text DEFAULT 'pending',
  rejection_reasons jsonb,
  ocr_result jsonb,
  final_score numeric(5,2),
  payment_date timestamptz,
  verified_at timestamptz,
  screenshot_hash text,
  verification_locked boolean,
  verification_locked_at timestamptz,
  verification_started_at timestamptz,
  verification_completed_at timestamptz,
  verification_duration bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS pending_reg_id uuid REFERENCES public.pending_registrations(id) ON DELETE SET NULL;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS verification_started_at timestamptz;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS verification_completed_at timestamptz;
ALTER TABLE public.upi_payments ADD COLUMN IF NOT EXISTS verification_duration bigint;

CREATE INDEX IF NOT EXISTS idx_upi_user_id ON public.upi_payments (user_id);
CREATE INDEX IF NOT EXISTS idx_upi_pending_reg_id ON public.upi_payments (pending_reg_id);
CREATE INDEX IF NOT EXISTS idx_upi_utr ON public.upi_payments (utr);
CREATE INDEX IF NOT EXISTS idx_upi_status ON public.upi_payments (status);

-- ============================================================
-- TABLE: processed_payments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.processed_payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id text,
  utr text,
  amount numeric(12,2),
  type text,
  status text,
  screenshot_hash text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: wallet_balances
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wallet_balances (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  userId text,
  balance numeric(12,2) DEFAULT 0,
  total_earned numeric(12,2) DEFAULT 0,
  total_withdrawn numeric(12,2) DEFAULT 0,
  totalDeposited numeric DEFAULT 0,
  updatedAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: wallet_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  userId text,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  type text,
  amount numeric(12,2),
  balance_before numeric(12,2) DEFAULT 0,
  balanceAfter numeric DEFAULT 0,
  balance_after numeric(12,2) DEFAULT 0,
  description text,
  reference_type text,
  reference_id text,
  razorpay_payment_id text,
  razorpay_order_id text,
  paymentId text,
  relatedUserId text,
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON public.wallet_transactions (user_id);

-- ============================================================
-- TABLE: topups
-- ============================================================
CREATE TABLE IF NOT EXISTS public.topups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  userId text,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  userName text,
  userEmail text,
  userPhone text,
  userReferralCode text,
  referred_by text,
  amount numeric(12,2),
  transactionId text,
  screenshotData text,
  sessionId text,
  verifiedViaCode boolean DEFAULT false,
  status text DEFAULT 'pending',
  utr text,
  screenshot_url text,
  adminId text,
  approvedAt timestamptz,
  rejectedAt timestamptz,
  sponsorBenefitAdded boolean DEFAULT false,
  deleted boolean DEFAULT false,
  deletedAt timestamptz,
  deletedBy text,
  verified_at timestamptz,
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topups_user ON public.topups (user_id);
CREATE INDEX IF NOT EXISTS idx_topups_status ON public.topups (status);

-- ============================================================
-- TABLE: topup_referral_income
-- ============================================================
CREATE TABLE IF NOT EXISTS public.topup_referral_income (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  userId text,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  userName text,
  userEmail text,
  fromUserId text,
  from_user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  fromUserName text,
  topupId text,
  topup_id uuid REFERENCES public.topups(id) ON DELETE CASCADE,
  amount numeric(12,2),
  level integer DEFAULT 1,
  status text DEFAULT 'locked',
  claimedAt timestamptz,
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topup_income_user ON public.topup_referral_income (user_id);
CREATE INDEX IF NOT EXISTS idx_topup_income_from ON public.topup_referral_income (from_user_id);

-- ============================================================
-- TABLE: referrals
-- ============================================================
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  referral_code text,
  referred_email text,
  referred_name text,
  referred_phone text,
  status text DEFAULT 'pending',
  reward_claimed boolean DEFAULT false,
  name text,
  email text,
  phone text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referrals_user ON public.referrals (user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON public.referrals (referral_code);

-- ============================================================
-- TABLE: notifications
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  userId text,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  senderId text,
  sender_id text,
  senderName text,
  sender_name text,
  receiverId text,
  receiverName text,
  title text,
  message text,
  type text,
  status text DEFAULT 'unread',
  is_read boolean DEFAULT false,
  readAt timestamptz,
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications (is_read);

-- ============================================================
-- TABLE: chat_conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id text PRIMARY KEY,
  convoId text,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  userId text,
  user_name text,
  userName text,
  userEmail text,
  last_message text,
  lastMessage text,
  lastSenderId text,
  last_message_at timestamptz,
  is_read boolean DEFAULT false,
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updatedAt timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: chat_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  convoId text,
  convo_id text REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  sender text,
  senderId text,
  receiverId text,
  message text,
  messageText text,
  is_read boolean DEFAULT false,
  isRead boolean DEFAULT false,
  isDelivered boolean DEFAULT true,
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_convo ON public.chat_messages (convo_id);

-- ============================================================
-- TABLE: admins
-- ============================================================
CREATE TABLE IF NOT EXISTS public.admins (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  email text UNIQUE NOT NULL,
  password_hash text,
  password text,
  name text DEFAULT 'Admin',
  role text DEFAULT 'admin',
  createdAt timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  action text,
  target_id text,
  target_type text,
  admin_id text,
  details jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON public.audit_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at);

-- ============================================================
-- TABLE: deletion_audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.deletion_audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id text,
  admin_name text,
  deleted_record_id text,
  record_type text,
  reason text,
  collection text,
  deleted_count integer,
  deleted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: sponsor_data
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sponsor_data (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  sponsor_id text,
  topup_amount numeric(12,2),
  status text,
  qualified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: sponsor_claims
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sponsor_claims (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE INDEX IF NOT EXISTS idx_sponsor_claims_sponsor ON public.sponsor_claims(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_claims_status ON public.sponsor_claims(status);

-- ============================================================
-- TABLE: topup_audit_log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.topup_audit_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  action text,
  adminId text,
  topupId text,
  reason text,
  previousData jsonb,
  timestamp timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: payment_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.payment_sessions (
  id text PRIMARY KEY,
  user_id text,
  type text DEFAULT 'topup',
  amount numeric,
  status text DEFAULT 'created',
  paymentId text,
  expires_at timestamptz,
  completedAt timestamptz,
  createdAt timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: razorpay_orders
-- ============================================================
CREATE TABLE IF NOT EXISTS public.razorpay_orders (
  id text PRIMARY KEY,
  sessionId text,
  userId text,
  paymentType text,
  pendingRegId text,
  userEmail text,
  status text DEFAULT 'created',
  completedAt timestamptz,
  createdAt timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: verification_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.verification_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id text,
  user_id text,
  utr text,
  layer integer,
  check_name text,
  passed boolean,
  score numeric(5,2),
  details jsonb DEFAULT '{}',
  verification_id text,
  payment_type text,
  selected_amount numeric,
  ocr_amount text,
  ocr_upi text,
  ocr_utr text,
  ocr_date text,
  ocr_confidence numeric,
  final_score numeric,
  status text,
  reason text,
  image_hash text,
  validation_steps jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- TABLE: sponsor_transfers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sponsor_transfers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  old_sponsor_id uuid REFERENCES public.users(id),
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

CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_user ON public.sponsor_transfers (user_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_new_sponsor ON public.sponsor_transfers (new_sponsor_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_transfers_status ON public.sponsor_transfers (status);

-- ============================================================
-- AUTO-CREATE wallet_balances on user signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.wallet_balances (id, userId, balance, total_earned, total_withdrawn)
  VALUES (NEW.id, NEW.id::text, 0, 0, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_user_created ON public.users;
CREATE TRIGGER on_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
