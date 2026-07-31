-- Permanent fix for the Registration 504 root cause: the code's fast-path
-- duplicate lookups (findUserByEmail / findUserByPhone) query the
-- email_hash / phone_hash columns. These columns were defined in the schema
-- but were never applied to the live database (error 42703), forcing every
-- registration to fall back to a full-table scan + wasted failing query.
--
-- Run this in the Supabase SQL editor (Dashboard -> SQL). It is idempotent —
-- safe to run multiple times.
--
-- After applying, run the backfill to populate hashes for existing users:
--   node scripts/backfill-user-hashes.js
-- (Hashes cannot be computed in SQL because email/phone are AES-256-GCM
--  encrypted; the script decrypts them via _crypto.js first.)

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_hash text;

CREATE INDEX IF NOT EXISTS idx_users_email_hash ON public.users (email_hash);
CREATE INDEX IF NOT EXISTS idx_users_phone_hash ON public.users (phone_hash);
