const { z } = require('zod');

const SCHEMA_VERSION = '1.0';

const sessionSchema = z.object({
  session_id: z.string(),
  source: z.string(),
  name: z.string().nullable().optional(),
  mode: z.string().nullable().optional(),
  project_path: z.string().nullable().optional(),
  project_path_hash: z.string().nullable().optional(),
  created_at: z.number().nullable().optional(),
  last_updated_at: z.number().nullable().optional(),
  message_count: z.number().int().nonnegative().optional(),
  encrypted: z.boolean().optional(),
});

const sessionStatsSchema = z.object({
  session_id: z.string(),
  total_messages: z.number().int().nonnegative().optional(),
  user_messages: z.number().int().nonnegative().optional(),
  assistant_messages: z.number().int().nonnegative().optional(),
  tool_messages: z.number().int().nonnegative().optional(),
  system_messages: z.number().int().nonnegative().optional(),
  tool_calls: z.array(z.string()).optional(),
  models: z.array(z.string()).optional(),
  total_input_tokens: z.number().int().nonnegative().optional(),
  total_output_tokens: z.number().int().nonnegative().optional(),
  total_cache_read: z.number().int().nonnegative().optional(),
  total_cache_write: z.number().int().nonnegative().optional(),
  total_user_chars: z.number().int().nonnegative().optional(),
  total_assistant_chars: z.number().int().nonnegative().optional(),
  analyzed_at: z.number().optional(),
});

const messageSchema = z.object({
  session_id: z.string(),
  seq: z.number().int().nonnegative(),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  input_tokens: z.number().int().nullable().optional(),
  output_tokens: z.number().int().nullable().optional(),
});

const syncPayloadSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  sync_id: z.string().uuid(),
  sent_at: z.number(),
  client: z.object({
    name: z.string(),
    version: z.string(),
    platform: z.string(),
    node_version: z.string().optional(),
  }),
  user: z.object({
    user_id: z.string(),
    email: z.string().email(),
    device_id: z.string(),
  }),
  cursor: z.object({
    since: z.number(),
    last_session_watermark: z.number().optional(),
  }),
  summary: z
    .object({
      sessions_scanned: z.number().optional(),
      sessions_changed: z.number().optional(),
      messages_uploaded: z.number().optional(),
      bytes_estimate: z.number().optional(),
    })
    .optional(),
  sessions: z.array(sessionSchema),
  session_stats: z.array(sessionStatsSchema),
  messages: z.array(messageSchema).default([]),
  heartbeat: z
    .object({
      editors_detected: z.array(z.string()).optional(),
      collector_uptime_sec: z.number().optional(),
    })
    .optional(),
});

const deviceAuthSchema = z.object({
  org_api_key: z.string().min(1),
  email: z.string().email(),
  device_name: z.string().optional(),
});

module.exports = {
  SCHEMA_VERSION,
  sessionSchema,
  sessionStatsSchema,
  messageSchema,
  syncPayloadSchema,
  deviceAuthSchema,
};
