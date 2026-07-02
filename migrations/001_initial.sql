-- Team AI Collector — initial schema (PRD §7.3)

CREATE TABLE IF NOT EXISTS organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL,
  policies JSONB NOT NULL DEFAULT '{"message_content":"none","hash_project_paths":false,"retention_days":90}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, email)
);

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_name TEXT,
  token_hash TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  org_id TEXT NOT NULL REFERENCES organizations(org_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  name TEXT,
  mode TEXT,
  project_path TEXT,
  project_path_hash TEXT,
  created_at BIGINT,
  last_updated_at BIGINT,
  message_count INTEGER DEFAULT 0,
  encrypted BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (org_id, user_id, source, session_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_org_updated ON sessions(org_id, last_updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(org_id, user_id);

CREATE TABLE IF NOT EXISTS session_stats (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  total_messages INTEGER DEFAULT 0,
  user_messages INTEGER DEFAULT 0,
  assistant_messages INTEGER DEFAULT 0,
  tool_messages INTEGER DEFAULT 0,
  system_messages INTEGER DEFAULT 0,
  tool_calls JSONB DEFAULT '[]'::jsonb,
  models JSONB DEFAULT '[]'::jsonb,
  total_input_tokens BIGINT DEFAULT 0,
  total_output_tokens BIGINT DEFAULT 0,
  total_cache_read BIGINT DEFAULT 0,
  total_cache_write BIGINT DEFAULT 0,
  total_user_chars BIGINT DEFAULT 0,
  total_assistant_chars BIGINT DEFAULT 0,
  analyzed_at BIGINT,
  PRIMARY KEY (org_id, user_id, source, session_id),
  FOREIGN KEY (org_id, user_id, source, session_id)
    REFERENCES sessions(org_id, user_id, source, session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  PRIMARY KEY (org_id, user_id, session_id, seq)
);

CREATE TABLE IF NOT EXISTS sync_events (
  sync_id UUID PRIMARY KEY,
  org_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  device_id TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  response_json JSONB,
  bytes_in INTEGER,
  sessions_count INTEGER DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_events_org_created ON sync_events(org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  device_id TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (device_id, window_start)
);

-- Public API: list users by org, and a user's messages by role.
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_messages_org_user_role ON messages(org_id, user_id, role);
