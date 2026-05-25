const { getDb } = require('./db');
const { getMessages } = require('@team-ai/adapters');

const insertStat = () =>
  getDb().prepare(`
    INSERT OR REPLACE INTO chat_stats (
      chat_id, total_messages, user_messages, assistant_messages, tool_messages, system_messages,
      tool_calls, models, total_user_chars, total_assistant_chars,
      total_input_tokens, total_output_tokens, total_cache_read, total_cache_write, analyzed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

const insertMsg = () =>
  getDb().prepare(`
    INSERT INTO messages (chat_id, seq, role, content, model, input_tokens, output_tokens, cache_read, cache_write)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

function analyzeAndStore(chat) {
  if (chat.encrypted) return;

  let messages;
  try {
    messages = getMessages(chat);
  } catch {
    return;
  }
  if (!messages || messages.length === 0) return;

  const db = getDb();
  const stats = {
    total: messages.length,
    user: 0,
    assistant: 0,
    tool: 0,
    system: 0,
    toolCalls: [],
    models: [],
    userChars: 0,
    assistantChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };

  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chat.composerId);
  const ins = insertMsg();
  const updBubble = db.prepare('UPDATE chats SET bubble_count = ? WHERE id = ?');

  let seq = 0;
  for (const msg of messages) {
    const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    if (msg.role === 'user') {
      stats.user++;
      stats.userChars += text.length;
    } else if (msg.role === 'assistant') {
      stats.assistant++;
      stats.assistantChars += text.length;
      if (msg._toolCalls?.length) {
        for (const tc of msg._toolCalls) stats.toolCalls.push(tc.name);
      }
      if (msg._inputTokens) stats.inputTokens += msg._inputTokens;
      if (msg._outputTokens) stats.outputTokens += msg._outputTokens;
      if (msg._cacheRead) stats.cacheRead += msg._cacheRead;
      if (msg._cacheWrite) stats.cacheWrite += msg._cacheWrite;
    } else if (msg.role === 'tool') stats.tool++;
    else if (msg.role === 'system') stats.system++;
    if (msg._model) stats.models.push(msg._model);

    const stored = text.length > 50000 ? text.slice(0, 50000) : text;
    ins.run(
      chat.composerId,
      seq++,
      msg.role,
      stored,
      msg._model || null,
      msg._inputTokens || null,
      msg._outputTokens || null,
      msg._cacheRead || null,
      msg._cacheWrite || null
    );
  }

  updBubble.run(messages.length, chat.composerId);
  insertStat().run(
    chat.composerId,
    stats.total,
    stats.user,
    stats.assistant,
    stats.tool,
    stats.system,
    JSON.stringify(stats.toolCalls),
    JSON.stringify(stats.models),
    stats.userChars,
    stats.assistantChars,
    stats.inputTokens,
    stats.outputTokens,
    stats.cacheRead,
    stats.cacheWrite,
    Date.now()
  );
}

module.exports = { analyzeAndStore };
