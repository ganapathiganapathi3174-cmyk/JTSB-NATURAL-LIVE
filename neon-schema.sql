-- Neon PostgreSQL Schema — Analytics, Logs, and Audit Data
-- Run this in Neon SQL Editor or via psql

-- Verification logs (payment verification audit trail)
CREATE TABLE IF NOT EXISTS verification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id TEXT,
  user_id TEXT,
  utr TEXT,
  layer INTEGER,
  check_name TEXT,
  passed BOOLEAN,
  score NUMERIC(5,2),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_verification_logs_payment_id ON verification_logs(payment_id);
CREATE INDEX IF NOT EXISTS idx_verification_logs_utr ON verification_logs(utr);
CREATE INDEX IF NOT EXISTS idx_verification_logs_created_at ON verification_logs(created_at DESC);

-- Payment logs (every payment attempt)
CREATE TABLE IF NOT EXISTS payment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  utr TEXT,
  amount NUMERIC(10,2),
  payment_type TEXT,
  status TEXT,
  screenshot_hash TEXT,
  upi_id TEXT,
  device_info TEXT,
  ip_address TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_logs_user_id ON payment_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_logs_utr ON payment_logs(utr);
CREATE INDEX IF NOT EXISTS idx_payment_logs_created_at ON payment_logs(created_at DESC);

-- Audit logs (admin actions, deletions, modifications)
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT,
  admin_id TEXT,
  admin_name TEXT,
  target_type TEXT,
  target_id TEXT,
  reason TEXT,
  previous_state JSONB DEFAULT '{}',
  new_state JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON audit_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);

-- Admin logs (admin-specific action logs)
CREATE TABLE IF NOT EXISTS admin_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id TEXT,
  admin_name TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_action ON admin_logs(action);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at DESC);

-- Analytics events (general analytics tracking)
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT,
  user_id TEXT,
  session_id TEXT,
  page TEXT,
  action TEXT,
  value NUMERIC(10,2),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at ON analytics_events(created_at DESC);

-- Daily analytics rollups
CREATE TABLE IF NOT EXISTS analytics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_registrations INTEGER DEFAULT 0,
  total_payments INTEGER DEFAULT 0,
  approved_payments INTEGER DEFAULT 0,
  rejected_payments INTEGER DEFAULT 0,
  manual_reviews INTEGER DEFAULT 0,
  total_topups INTEGER DEFAULT 0,
  total_revenue NUMERIC(12,2) DEFAULT 0,
  unique_users INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  UNIQUE(date)
);

CREATE INDEX IF NOT EXISTS idx_analytics_daily_date ON analytics_daily(date DESC);
