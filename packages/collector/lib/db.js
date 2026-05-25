const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { CONFIG_DIR } = require('./config');

const DB_PATH = path.join(CONFIG_DIR, 'cache.db');

let db = null;

function initDb() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (db) return db;
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT,
      mode TEXT,
      folder TEXT,
      created_at INTEGER,
      last_updated_at INTEGER,
      encrypted INTEGER DEFAULT 0,
      bubble_count INTEGER DEFAULT 0,
      _meta TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_stats (
      chat_id TEXT PRIMARY KEY,
      total_messages INTEGER DEFAULT 0,
      user_messages INTEGER DEFAULT 0,
      assistant_messages INTEGER DEFAULT 0,
      tool_messages INTEGER DEFAULT 0,
      system_messages INTEGER DEFAULT 0,
      tool_calls TEXT DEFAULT '[]',
      models TEXT DEFAULT '[]',
      total_user_chars INTEGER DEFAULT 0,
      total_assistant_chars INTEGER DEFAULT 0,
      total_input_tokens INTEGER DEFAULT 0,
      total_output_tokens INTEGER DEFAULT 0,
      total_cache_read INTEGER DEFAULT 0,
      total_cache_write INTEGER DEFAULT 0,
      analyzed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read INTEGER,
      cache_write INTEGER
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS outbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      attempts INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
  `);
  return db;
}

function getDb() {
  if (!db) initDb();
  return db;
}

function getMeta(key) {
  const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(key, value) {
  getDb()
    .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .run(key, String(value));
}

module.exports = { initDb, getDb, getMeta, setMeta, DB_PATH };
