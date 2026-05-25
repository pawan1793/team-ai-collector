const { getDb } = require('./db');
const { getAllChats, resetCaches } = require('@team-ai/adapters');
const { analyzeAndStore } = require('./analyzer');

const insertChat = () =>
  getDb().prepare(`
    INSERT OR REPLACE INTO chats (id, source, name, mode, folder, created_at, last_updated_at, encrypted, bubble_count, _meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

function normalizeFolder(folder) {
  if (!folder) return folder;
  try {
    return require('path').normalize(folder.replace('file://', ''));
  } catch {
    return folder;
  }
}

function scanAll(onProgress, opts = {}) {
  const force = opts.force || false;
  if (force || opts.resetCaches) resetCaches();

  const db = getDb();
  const chats = (opts.chats || getAllChats()).map((c) => {
    c.folder = normalizeFolder(c.folder);
    return c;
  });
  const total = chats.length;
  let scanned = 0;
  let analyzed = 0;
  let skipped = 0;

  const existing = {};
  for (const row of db.prepare('SELECT id, last_updated_at, bubble_count FROM chats').all()) {
    existing[row.id] = { ts: row.last_updated_at, bc: row.bubble_count };
  }

  const ins = insertChat();
  const batch = db.transaction((batchChats) => {
    for (const chat of batchChats) {
      ins.run(
        chat.composerId,
        chat.source,
        chat.name || null,
        chat.mode || null,
        chat.folder || null,
        chat.createdAt || null,
        chat.lastUpdatedAt || null,
        chat.encrypted ? 1 : 0,
        chat.bubbleCount || 0,
        JSON.stringify({
          _fullPath: chat._fullPath,
          _dbPath: chat._dbPath,
          _filePath: chat._filePath,
        })
      );
    }
  });
  batch(chats);

  if (onProgress) onProgress({ scanned: 0, analyzed: 0, skipped: 0, total });

  for (const chat of chats) {
    scanned++;
    const chatTs = chat.lastUpdatedAt || chat.createdAt || 0;
    const cached = existing[chat.composerId];
    if (
      !force &&
      cached?.ts &&
      cached.ts >= chatTs &&
      (cached.bc || 0) >= (chat.bubbleCount || 0)
    ) {
      const hasStat = db.prepare('SELECT 1 FROM chat_stats WHERE chat_id = ?').get(chat.composerId);
      if (hasStat) {
        skipped++;
        if (onProgress) onProgress({ scanned, analyzed, skipped, total });
        continue;
      }
    }

    if (!chat.encrypted && (chat.name || chat.bubbleCount > 0)) {
      try {
        analyzeAndStore(chat);
        analyzed++;
      } catch {
        skipped++;
      }
    } else {
      skipped++;
    }
    if (onProgress) onProgress({ scanned, analyzed, skipped, total });
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('last_scan', String(Date.now()));
  return { total, analyzed, skipped };
}

module.exports = { scanAll, normalizeFolder };
