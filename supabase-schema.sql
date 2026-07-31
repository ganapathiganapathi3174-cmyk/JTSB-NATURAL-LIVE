-- Supabase Migration: Replace Firebase with Supabase
-- Run this in Supabase SQL Editor

-- ==================== EXTENSIONS ====================
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ==================== USERS TABLE ====================
create table if not exists public.users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  email_hash text,
  phone text,
  phone_hash text,
  name text,
  password_hash text,
  referral_code text unique,
  referred_by text,
  referred_by_status text default 'pending',
  account_status text default 'inactive',
  payment_status text default 'pending',
  membership_type text default 'basic',
  membership_paid boolean default false,
  active boolean default false,
  approved boolean default false,
  approved_date timestamptz,
  joined_date timestamptz,
  last_active_at timestamptz,
  referral_limit_reached boolean default false,
  referrals_count integer default 0,
  total_referral_count integer default 0,
  sponsor_topup_completed boolean default false,
  topup_referral_qualified boolean default false,
  sponsor_credited boolean default false,
  locked_income numeric(12,2) default 0,
  activated_at timestamptz,
  activated_by text,
  activation_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_users_email on public.users(email);
create index if not exists idx_users_email_hash on public.users(email_hash);
create index if not exists idx_users_phone on public.users(phone);
create index if not exists idx_users_phone_hash on public.users(phone_hash);
create index if not exists idx_users_referral_code on public.users(referral_code);
create index if not exists idx_users_referred_by on public.users(referred_by);
create index if not exists idx_users_account_status on public.users(account_status);
create index if not exists idx_users_payment_status on public.users(payment_status);

-- Add hash columns for existing databases (CREATE TABLE IF NOT EXISTS skips existing tables)
alter table public.users add column if not exists email_hash text;
alter table public.users add column if not exists phone_hash text;

-- ==================== UNIQUES TABLE (email/phone uniqueness) ====================
create table if not exists public.uniques (
  id text primary key,
  user_id uuid references public.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- ==================== PENDING REGISTRATIONS ====================
create table if not exists public.pending_registrations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete set null,
  name text,
  email text,
  phone text,
  password_hash text,
  referral_code text,
  utr text,
  amount numeric(12,2),
  status text default 'pending',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_pending_reg_email on public.pending_registrations(email);
create index if not exists idx_pending_reg_status on public.pending_registrations(status);

-- ==================== UPI PAYMENTS ====================
create table if not exists public.upi_payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete set null,
  pending_reg_id uuid references public.pending_registrations(id) on delete set null,
  utr text,
  utr_hash text,
  upi_id text,
  amount numeric(12,2),
  amount_option text,
  payment_type text,
  screenshot_url text,
  status text default 'pending',
  rejection_reasons jsonb,
  ocr_result jsonb,
  final_score numeric(5,2),
  fraud_score numeric(5,2),
  risk_score numeric(5,2),
  screenshot_hash text,
  payment_date timestamptz,
  verified_at timestamptz,
  verification_locked boolean default false,
  verification_locked_at timestamptz,
  verification_started_at timestamptz,
  verification_completed_at timestamptz,
  verification_duration bigint,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_upi_user_id on public.upi_payments(user_id);
create index if not exists idx_upi_utr on public.upi_payments(utr);
create index if not exists idx_upi_utr_hash on public.upi_payments(utr_hash);
create index if not exists idx_upi_screenshot_hash on public.upi_payments(screenshot_hash);
create index if not exists idx_upi_status on public.upi_payments(status);

-- ==================== PROCESSED PAYMENTS ====================
create table if not exists public.processed_payments (
  id uuid primary key default uuid_generate_v4(),
  user_id text,
  utr text,
  amount numeric(12,2),
  type text,
  status text,
  screenshot_hash text,
  created_at timestamptz default now()
);

-- ==================== WALLET BALANCES ====================
create table if not exists public.wallet_balances (
  id uuid primary key references public.users(id) on delete cascade,
  balance numeric(12,2) default 0,
  total_earned numeric(12,2) default 0,
  total_withdrawn numeric(12,2) default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ==================== WALLET TRANSACTIONS ====================
create table if not exists public.wallet_transactions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  type text,
  amount numeric(12,2),
  balance_before numeric(12,2) default 0,
  balance_after numeric(12,2) default 0,
  description text,
  reference_type text,
  reference_id text,
  created_at timestamptz default now()
);

create index if not exists idx_wallet_tx_user on public.wallet_transactions(user_id);

-- ==================== TOPUPS ====================
create table if not exists public.topups (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  amount numeric(12,2),
  status text default 'pending',
  utr text,
  screenshot_url text,
  verified_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_topups_user on public.topups(user_id);
create index if not exists idx_topups_status on public.topups(status);

-- ==================== TOPUP REFERRAL INCOME ====================
create table if not exists public.topup_referral_income (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  from_user_id uuid references public.users(id) on delete cascade,
  topup_id uuid references public.topups(id) on delete cascade,
  amount numeric(12,2),
  level integer default 1,
  status text default 'locked',
  created_at timestamptz default now()
);

create index if not exists idx_topup_income_user on public.topup_referral_income(user_id);
create index if not exists idx_topup_income_from on public.topup_referral_income(from_user_id);

-- ==================== REFERRALS ====================
create table if not exists public.referrals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  referral_code text,
  referred_email text,
  referred_name text,
  referred_phone text,
  status text default 'pending',
  reward_claimed boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_referrals_user on public.referrals(user_id);
create index if not exists idx_referrals_code on public.referrals(referral_code);

-- ==================== NOTIFICATIONS ====================
create table if not exists public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  receiverId text,
  senderId text,
  senderName text,
  title text,
  message text,
  type text,
  status text default 'unread',
  is_read boolean default false,
  readAt timestamptz,
  createdAt timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_notifications_user on public.notifications(user_id);
create index if not exists idx_notifications_read on public.notifications(is_read);
create index if not exists idx_notifications_receiver on public.notifications(receiverId);
create index if not exists idx_notifications_status on public.notifications(status);

-- ==================== CHAT CONVERSATIONS ====================
create table if not exists public.chat_conversations (
  id text primary key,
  user_id uuid references public.users(id) on delete cascade,
  user_name text,
  last_message text,
  last_message_at timestamptz,
  is_read boolean default false,
  created_at timestamptz default now()
);

-- ==================== CHAT MESSAGES ====================
create table if not exists public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  convo_id text references public.chat_conversations(id) on delete cascade,
  sender text,
  message text,
  is_read boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_chat_convo on public.chat_messages(convo_id);

-- ==================== ADMINS ====================
create table if not exists public.admins (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  password_hash text,
  name text default 'Admin',
  role text default 'admin',
  created_at timestamptz default now()
);

-- ==================== AUDIT LOGS ====================
create table if not exists public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  action text,
  target_id text,
  target_type text,
  admin_id text,
  details jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_audit_logs_action on public.audit_logs(action);
create index if not exists idx_audit_logs_target on public.audit_logs(target_id, target_type);
create index if not exists idx_audit_logs_admin on public.audit_logs(admin_id);
create index if not exists idx_audit_logs_created on public.audit_logs(created_at);

-- ==================== DELETION AUDIT LOGS ====================
create table if not exists public.deletion_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  admin_id text,
  admin_name text,
  deleted_record_id text,
  record_type text,
  reason text,
  collection text,
  deleted_count integer,
  deleted_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ==================== SPONSOR DATA ====================
create table if not exists public.sponsor_data (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  sponsor_id text,
  topup_amount numeric(12,2),
  status text,
  qualified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============================================================
-- TABLE: sponsor_claims
-- ============================================================
create table if not exists public.sponsor_claims (
  id uuid primary key default uuid_generate_v4(),
  sponsor_id uuid references public.users(id) on delete cascade,
  claim_amount numeric(12,2) default 0,
  items_count integer default 0,
  items jsonb default '[]',
  status text default 'pending',
  claim_date timestamptz default now(),
  approved_at timestamptz,
  approved_by text,
  rejected_at timestamptz,
  rejected_by text,
  rejection_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sponsor_claims_sponsor on public.sponsor_claims(sponsor_id);
create index if not exists idx_sponsor_claims_status on public.sponsor_claims(status);

-- ============================================================
-- TABLE: topup_audit_log
-- ============================================================
create table if not exists public.topup_audit_log (
  id uuid primary key default uuid_generate_v4(),
  action text,
  adminId text,
  topupId text,
  reason text,
  previousData jsonb,
  timestamp timestamptz default now()
);

-- ============================================================
-- TABLE: payment_sessions
-- ============================================================
create table if not exists public.payment_sessions (
  id text primary key,
  user_id text,
  pending_reg_id text,
  type text default 'topup',
  amount numeric,
  expected_amount numeric,
  expected_upi_id text,
  status text default 'created',
  verification_status text,
  verification_score numeric(5,2),
  screenshot_url text,
  ocr_result jsonb,
  rejection_reasons jsonb,
  final_score numeric(5,2),
  utr_hash text,
  screenshot_hash text,
  fraud_score numeric(5,2),
  risk_score numeric(5,2),
  verification_locked boolean default false,
  verification_locked_at timestamptz,
  customer_email text,
  customer_name text,
  paymentId text,
  expires_at timestamptz,
  completedAt timestamptz,
  createdAt timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_sessions_utr_hash on public.payment_sessions(utr_hash);
create index if not exists idx_sessions_screenshot_hash on public.payment_sessions(screenshot_hash);
create index if not exists idx_sessions_status on public.payment_sessions(status);

-- ============================================================
-- TABLE: payment_confirm_sessions
-- ============================================================
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
-- TABLE: verification_logs
-- ============================================================
create table if not exists public.verification_logs (
  id uuid primary key default uuid_generate_v4(),
  payment_id text,
  user_id text,
  utr text,
  layer integer,
  check_name text,
  passed boolean,
  score numeric(5,2),
  details jsonb default '{}',
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
  created_at timestamptz default now()
);

-- ==================== ROW LEVEL SECURITY ====================
alter table public.users enable row level security;
alter table public.uniques enable row level security;
alter table public.pending_registrations enable row level security;
alter table public.upi_payments enable row level security;
alter table public.verification_logs enable row level security;
alter table public.processed_payments enable row level security;
alter table public.wallet_balances enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.topups enable row level security;
alter table public.topup_referral_income enable row level security;
alter table public.referrals enable row level security;
alter table public.notifications enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.admins enable row level security;
alter table public.audit_logs enable row level security;
alter table public.deletion_audit_logs enable row level security;
alter table public.sponsor_data enable row level security;
alter table public.sponsor_claims enable row level security;

-- ==================== RLS POLICIES ====================

-- Users: can read own data; admin can read all
create policy "Users can read own data"
  on public.users for select
  using (auth.uid() = id);

-- Service role bypass (handled by SUPABASE_SERVICE_KEY)
-- Anonymous access for registration checks
create policy "Allow registration email check"
  on public.users for select
  using (true);

-- UPI Payments: users can see own; admin all
create policy "Users can view own payments"
  on public.upi_payments for select
  using (auth.uid() = user_id);

-- Wallet: users see own
create policy "Users can view own wallet"
  on public.wallet_balances for select
  using (auth.uid() = id);

-- Notifications: users see own
create policy "Users can view own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

-- ==================== DEFAULT ADMIN ====================
-- ⚠️ SECURITY: This default admin is DEV ONLY. `handlers/adminLogin.js` disables
-- the default-admin login path when NODE_ENV=production or Vercel. In production,
-- change the password_hash (or delete this row and provision via ADMIN_EMAIL +
-- ADMIN_PASSWORD_HASH env vars). SHA-256 hash shown matches jayaraj7523.
insert into public.admins (email, password_hash, name)
values ('jayaraj@gmail.com', 'bc21f55e8275b8274e8e704fe2de13a43a46f70cc602e6888ec52893ab790b13', 'Admin')
on conflict (email) do nothing;

-- ==================== HELPER FUNCTIONS ====================

-- Function to auto-create wallet on user creation
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.wallet_balances (id, balance, total_earned, total_withdrawn)
  values (new.id, 0, 0, 0);
  return new;
end;
$$;

-- Trigger to create wallet for new users
drop trigger if exists on_user_created on public.users;
create trigger on_user_created
  after insert on public.users
  for each row execute function public.handle_new_user();

-- Function to generate unique referral code
create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  code text;
  chars text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
begin
  loop
    code := '';
    for i in 1..8 loop
      code := code || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    end loop;
    exit when not exists (select 1 from public.users where referral_code = code);
  end loop;
  return code;
end;
$$;

-- ==================== UPGRADE REQUESTS ====================
create table if not exists public.upgrade_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  user_name text,
  user_email text,
  user_phone text,
  current_plan text,
  requested_plan text not null,
  amount numeric(12,2) not null,
  referral_code text,
  status text default 'pending',
  admin_id text,
  rejection_reason text,
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_upgrade_req_user on public.upgrade_requests(user_id);
create index if not exists idx_upgrade_req_status on public.upgrade_requests(status);
create index if not exists idx_upgrade_req_created on public.upgrade_requests(created_at);

-- ==================== PAYMENT AI LOGS ====================
create table if not exists public.payment_ai_logs (
  id uuid primary key default uuid_generate_v4(),
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
  fraud_flags jsonb default '[]',
  final_decision text,
  confidence numeric(5,2),
  reasons jsonb default '[]',
  matched_fields jsonb default '{}',
  processing_time_ms integer,
  ai_model_used text,
  created_at timestamptz default now()
);

create index if not exists idx_payment_ai_logs_payment on public.payment_ai_logs(payment_id);
create index if not exists idx_payment_ai_logs_created on public.payment_ai_logs(created_at);

alter table public.upgrade_requests enable row level security;
alter table public.payment_ai_logs enable row level security;

-- ==================== BACKFILL: HASH COLUMNS (Run ONCE after adding columns) ====================
-- email_hash / phone_hash columns are populated automatically for NEW inserts
-- via encryptSensitive() in _supabase.js.
-- For EXISTING rows, run the Node.js script:
--   node api/backfillHashes.js
-- or if email/phone are stored IN CLEAR (not encrypted), use SQL:
--   UPDATE public.users SET email_hash = encode(sha256(lower(trim(email))::bytea), 'hex');
--   UPDATE public.users SET phone_hash = encode(sha256(trim(phone)::bytea), 'hex');
