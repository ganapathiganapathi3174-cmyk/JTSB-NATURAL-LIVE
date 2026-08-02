# FULL DATABASE DIAGNOSIS — Supabase `gaqxnvqxgzcvbrpigiad` (Aug 01, 2026)

## 1. Project Identity

| Property | Value | Source |
|----------|-------|--------|
| Project ref | `gaqxnvqxgzcvbrpigiad` | `SUPABASE_URL` + OpenAPI host |
| Host | `gaqxnvqxgzcvbrpigiad.supabase.co:443` | OpenAPI |
| PostgREST version | **14.5** (OpenAPI title "standard public schema") | `/rest/v1/` swagger |
| Postgres version | **not probed** — no `postgres://` URL / PAT / psql on this machine. PostgREST 14.5 ≠ PG version. `select version()` needs a DB connection. | limitation |
| Auth | service JWT via `.env.local` (`SUPABASE_SERVICE_KEY`) | REST 200 on probes |
| DB connectivity | confirmed through REST | 200s throughout |

**Cannot obtain from this machine:** `information_schema.columns`, exact `version()`, or the SQL-editor error output. Needs operator SQL-editor run or a `postgres://` URL / management PAT.

## 2. Why 0004 Had Zero Effect (the central question)

**Evidence — `payment_sessions.screenshot_phash` was the FIRST genuinely-new ALTER in 0004 (line 62) and is STILL MISSING live.** Every other new column in 0004 (sections 1b, 2, 3, 4, 5b, 5c, 5d, 6) is also still missing. The only columns present that 0004 references (`utr`, `expected_amount`, `expected_upi_id` on `payment_sessions`) already existed **before** 0004 — they came from migration 0002 (OpenAPI shows all 0002 columns present; 0002 predates this session).

Therefore **0004 executed 0 effective statements against this project's database.** Three hypotheses, in order of likelihood:

| # | Hypothesis | Plausibility |
|---|-----------|--------------|
| H1 | The SQL ran against a **different project/database** (wrong DB selected in the SQL editor, or a local/dev DB). | **Highest** — explains 100% zero-effect even for the first new ALTER. Postgres DDL is transactional per-statement; a later failure would NOT roll back earlier `ALTER ADD COLUMN IF NOT EXISTS`. So zero effect of *all* sections is not explained by a mid-script error — only by "never ran here". |
| H2 | The editor reported success but the script was **saved but not executed** / executed in a transaction block that was rolled back manually. | Possible — but a manual ROLLBACK after a full script run is not a typical editor flow. |
| H3 | Script errored at the very first statement. **Ruled out** — line 56-58 are `ALTER ... IF NOT EXISTS` on columns that already exist; they cannot error. The earliest possible error is line 149 `uuid_generate_v4()` in `CREATE TABLE audit_logs`, but Postgres autocommits each ALTER, so even then sections A-E would have applied. They did not. | Ruled out as full explanation |

**The `uuid_generate_v4()` question (H3 partial):** RPC probe `POST /rest/v1/rpc/uuid_generate_v4` → 404 PGRST202, and `gen_random_uuid` → 404 PGRST202. This does **not** prove the extensions are absent — PostgREST only exposes `public`-schema functions, and these live in `extensions`/`pg_catalog`. It only proves they are not REST-callable. Definitively resolving the extension question requires `SELECT extname FROM pg_extension;`. **0005 sidesteps the risk entirely by using `gen_random_uuid()` (PostgreSQL core since v13) instead of `uuid_generate_v4()`.**

**Bottom line:** 0004 has not been applied to this project. Applying 0005 (the verified-missing subset) is the correct next step. Do NOT re-run 0004 expecting a different result — first confirm the target database is `gaqxnvqxgzcvbrpigiad`.

## 3. Expected vs Live Schema — Complete Comparison

Legend: ✅ present · ❌ MISSING (42703) · ⚠️ present but different name · 🚫 table absent

### upi_payments (23 live cols; 8 missing)
| Expected (code writes) | Live | Datatype (as applied in 0005) |
|---|---|---|
| `fraud_score` | ❌ 42703 | `numeric(5,2) DEFAULT 0` |
| `risk_score` | ❌ 42703 | `numeric(5,2) DEFAULT 0` |
| `utr_hash` | ❌ 42703 | `text` |
| `verified_by` | ❌ 42703 | `text` |
| `screenshot_phash` | ❌ 42703 | `text` |
| `verification_attempts` | ❌ 42703 | `integer DEFAULT 0` |
| `next_retry_at` | ❌ 42703 | `timestamptz` |
| `last_error` | ❌ 42703 | `text` |
| `verification_started_at/completed_at/duration` | ✅ | — |

### payment_sessions (29 live cols; 4 missing)
| Expected | Live | Datatype |
|---|---|---|
| `screenshot_phash` | ❌ 42703 | `text` |
| `verification_attempts` | ❌ 42703 | `integer DEFAULT 0` |
| `next_retry_at` | ❌ 42703 | `timestamptz` |
| `last_error` | ❌ 42703 | `text` |
| `utr`, `expected_amount`, `expected_upi_id` | ✅ (from 0002) | — |
| `fraud_score`, `risk_score`, `utr_hash`, `screenshot_hash` | ✅ (from 0002) | — |
| `paymentId` (camelCase write) | ⚠️ only `paymentid` lowercase exists → 42703 on write; fallback works | — |

### notifications (17 live cols; 4 missing)
| Expected (camelCase writes) | Live | Datatype |
|---|---|---|
| `receiverId` | ❌ 42703 | `text` |
| `senderId` | ❌ 42703 | `text` |
| `senderName` | ❌ 42703 | `text` |
| `createdAt` | ❌ 42703 | `timestamptz DEFAULT now()` |
| `receiverid/senderid/sendername/createdat/title/status/...` | ✅ (lowercase variants exist) | — |

### verification_logs (23 live cols; 12 missing)
| Expected | Live | Datatype |
|---|---|---|
| `confidence` | ❌ 42703 | `numeric` |
| `reasons` | ❌ 42703 | `jsonb DEFAULT '[]'` |
| `matched_fields` | ❌ 42703 | `jsonb DEFAULT '{}'` |
| `extracted_fields` | ❌ 42703 | `jsonb DEFAULT '{}'` |
| `checks` | ❌ 42703 | `jsonb DEFAULT '{}'` |
| `fraud_score` | ❌ 42703 | `numeric(5,2) DEFAULT 0` |
| `fraud_flags` | ❌ 42703 | `jsonb DEFAULT '[]'` |
| `ocr_engines` | ❌ 42703 | `integer DEFAULT 0` |
| `duplicate_check` | ❌ 42703 | `text` |
| `decision_factors` | ❌ 42703 | `jsonb DEFAULT '{}'` |
| `stages` | ❌ 42703 | `jsonb DEFAULT '{}'` |
| `duration_ms` | ❌ 42703 | `bigint DEFAULT 0` |
| `status/reason/ocr_confidence/final_score/payment_id` | ✅ | — |

### users (74 live cols; 1 missing)
| Expected | Live | Datatype |
|---|---|---|
| `topup_referral_qualified_count` | ❌ 42703 | `integer DEFAULT 0` |
| `topup_referral_qualified` / `topup_referrals_count` | ✅ | — |

### topup_referral_income (16 live cols; 1 missing)
| Expected | Live | Datatype |
|---|---|---|
| `updated_at` (auto-appended by `updateDoc`) | ❌ 42703 | `timestamptz` |

### wallet_balances (9 live cols; 1 missing — OPTIONAL)
| Expected | Live | Datatype |
|---|---|---|
| `user_id` | ❌ 42703 | `text` (code keys by `id`; decorative only) |

### audit_logs (TABLE)
| Expected | Live |
|---|---|
| `audit_logs` table | 🚫 **404 PGRST205 — TABLE ABSENT** (every audit write fails silently) |
| Note | Live schema exposes `topup_audit_log` instead; code writes `audit_logs`. |

### False positives (reclassified — NOT gaps, do not add)
- `payment_sessions.upi_id` — no write target (writes go to `upi_payments.upi_id` which exists)
- `wallet_balances.user_id` — flagged in inventory but is a genuine missing column; **0005 includes it but it is optional/decorative** (code addresses wallets by `id`)
- The 12 `verification_logs` cols — genuinely missing but written via `addDocFiltered` → stripped, non-fatal (degraded only)

## 4. Impact Severity (what breaks today)

| Severity | Objects | Effect |
|----------|---------|--------|
| **CRITICAL** | `upi_payments` 4 cols (fraud_score/risk_score/utr_hash/verified_by) | `updateDoc` dies at 42703 → payment never becomes `verified`, stays `pending` forever |
| **CRITICAL** | `audit_logs` table | every audit insert silently fails (404) |
| **CRITICAL** | `notifications` 4 camelCase cols | every notification insert fails (42703) |
| **HIGH** | `users.topup_referral_qualified_count` | topup referral qualification update dies before wallet credit |
| **HIGH** | `topup_referral_income.updated_at` | `status:'eligible'` unlock fails (updateDoc auto-appends updated_at) |
| **MEDIUM** | `payment_sessions.paymentId` vs `paymentid` | link never saved; fallback search works (degraded) |
| **LOW** | 4+12 hardening/audit cols, `wallet_balances.user_id` | stripped by Filtered helpers → degraded, not fatal |

## 5. Deliverables Produced

- `scripts/0005-only-missing-objects.sql` — **ONLY the 31 verified-missing columns + audit_logs table + indexes**. Non-destructive (`ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`). Uses `gen_random_uuid()` to avoid the uuid-ossp dependency question. Includes verify-after-apply SQL.
- **Validation: PASS** — read-only probe re-checked all 31 columns + audit_logs on live: every target confirmed `42703`/404, so 0005 introduces zero redundant ALTERs.

## 6. What I Still Cannot Do From This Machine

1. Read `information_schema` / `version()` (no PG URL, no PAT, no psql, `exec_sql` RPC → 404).
2. Determine the exact SQL-editor error the operator saw (needs the editor output or a DB connection).
3. Apply 0005 (needs operator: **Dashboard → SQL Editor → paste 0005**).

## 7. Recommended Next Step

Operator pastes `scripts/0005-only-missing-objects.sql` into the **Supabase SQL Editor for project `gaqxnvqxgzcvbrpigiad`**, then returns the output. If it shows success, re-run `node scripts/validate-live-schema.js` and the write-probe to confirm 0 missing.
