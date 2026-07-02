-- Team AI Collector — cost tracking + account (Phase 2)
-- Idempotent: safe to run repeatedly and on existing databases.

-- Feature 3: internal account name per user (nullable for legacy users until reconnect)
ALTER TABLE users ADD COLUMN IF NOT EXISTS account TEXT;
CREATE INDEX IF NOT EXISTS idx_users_org_account ON users(org_id, account);

-- Feature 1: estimated AI cost stored per session (derived from token totals + dominant model)
ALTER TABLE session_stats ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC;
ALTER TABLE session_stats ADD COLUMN IF NOT EXISTS cost_currency TEXT DEFAULT 'USD';
ALTER TABLE session_stats ADD COLUMN IF NOT EXISTS cost_model TEXT;
