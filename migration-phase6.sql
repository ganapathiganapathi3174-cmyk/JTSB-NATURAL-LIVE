-- ============================================================
-- Migration Phase 6: Production hardening schema drift
-- Fixes missing columns and tables discovered in audit
-- Safe to run multiple times (IF NOT EXISTS everywhere)
-- ============================================================

-- 1. notifications: receiverId + createdAt (canonical schema has these; live DB missing)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'notifications' and lower(column_name) = 'receiverid'
  ) then
    alter table public.notifications add column "receiverId" text;
    create index if not exists idx_notifications_receiver on public.notifications("receiverId");
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'notifications' and lower(column_name) = 'createdat'
  ) then
    alter table public.notifications add column "createdAt" timestamptz default now();
  end if;
end $$;

-- 2. payment_sessions: paymentId + ocr_result (canonical has these; live DB missing)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'payment_sessions' and lower(column_name) = 'paymentid'
  ) then
    alter table public.payment_sessions add column "paymentId" text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'payment_sessions' and column_name = 'ocr_result'
  ) then
    alter table public.payment_sessions add column "ocr_result" jsonb default '{}';
  end if;
end $$;

-- 3. upi_payments: fraud_score (canonical has this; live DB missing) + pipeline_session (code-needed)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'upi_payments' and column_name = 'fraud_score'
  ) then
    alter table public.upi_payments add column "fraud_score" numeric(5,2);
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'upi_payments' and column_name = 'pipeline_session'
  ) then
    alter table public.upi_payments add column "pipeline_session" text;
  end if;
end $$;

-- 4. users: topup_referral_qualified_count (code-needed, not yet in canonical)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'users' and column_name = 'topup_referral_qualified_count'
  ) then
    alter table public.users add column "topup_referral_qualified_count" integer default 0;
  end if;
end $$;

-- 5. verification_logs: checks column (code-needed for audit)
do $$ begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'verification_logs' and column_name = 'checks'
  ) then
    alter table public.verification_logs add column "checks" jsonb default '{}';
  end if;
end $$;

-- 6. sponsor_claims table (canonical schema has it; live DB 404)
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
alter table public.sponsor_claims enable row level security;

-- 7. audit_logs + deletion_audit_logs tables (canonical schema has them; live DB missing — silent audit loss)
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
alter table public.audit_logs enable row level security;

create table if not exists public.deletion_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  admin_id text,
  admin_name text,
  deleted_record_id text,
  record_type text,
  reason text,
  collection text,
  deleted_count integer,
  deleted_at timestamptz,
  created_at timestamptz default now()
);
alter table public.deletion_audit_logs enable row level security;