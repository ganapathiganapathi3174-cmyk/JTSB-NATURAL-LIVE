-- Run in Supabase SQL editor (Dashboard > SQL Editor > New Query)
CREATE TABLE IF NOT EXISTS public."paymentSessions" (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  "paymentType" TEXT NOT NULL,
  plan TEXT,
  amount NUMERIC NOT NULL,
  status TEXT DEFAULT 'pending',
  "userId" TEXT,
  "pendingRegId" TEXT,
  "transactionReference" TEXT,
  "transactionTime" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "expiresAt" TIMESTAMPTZ,
  "approvedAt" TIMESTAMPTZ,
  matched BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_amount_status ON public."paymentSessions"(amount, status);
CREATE INDEX IF NOT EXISTS idx_sms_ref ON public."paymentSessions"("transactionReference");
