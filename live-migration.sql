-- Live DB schema sync — adds missing columns/tables to match supabase-schema.sql
-- Run this in Supabase Studio → SQL Editor

-- payment_sessions
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_status" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "verification_score" numeric(5,2);
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "final_score" numeric(5,2);
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "rejection_reasons" jsonb DEFAULT '[]';
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "ocr_result" jsonb DEFAULT '{}';
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "screenshot_url" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "completedAt" timestamptz;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "createdAt" timestamptz DEFAULT now();
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "customer_email" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "customer_name" text;
ALTER TABLE public.payment_sessions ADD COLUMN IF NOT EXISTS "paymentId" text;

-- notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "createdAt" timestamptz DEFAULT now();
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "is_read" boolean DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "readAt" timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "receiverId" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "senderId" text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS "senderName" text;

-- audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  action text,
  target_id text,
  target_type text,
  admin_id text,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs(target_id, target_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin ON public.audit_logs(admin_id);

-- sponsor_claims
CREATE TABLE IF NOT EXISTS public.sponsor_claims (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(id) on delete cascade,
  sponsor_id uuid references public.users(id) on delete set null,
  status text DEFAULT 'pending',
  amount numeric(12,2),
  reference_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sponsor_claims_user ON public.sponsor_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_claims_sponsor ON public.sponsor_claims(sponsor_id);

-- indexes for payment_sessions
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status ON public.payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_user ON public.payment_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_pending_reg ON public.payment_sessions(pending_reg_id);
