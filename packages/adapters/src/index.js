/**
 * Team AI Collector — editor adapters (MVP: Claude Code + Cursor)
 * Forked from Agentlytics (ISC). See references/agentlytics/editors/
 */

const claude = require('./editors/claude');
const cursor = require('./editors/cursor');

const editors = [claude, cursor];

const editorLabels = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
};

function getAllChats() {
  const chats = [];
  for (const editor of editors) {
    try {
      chats.push(...editor.getChats());
    } catch {
      /* skip broken adapters */
    }
  }
  chats.sort((a, b) => {
    const ta = a.lastUpdatedAt || a.createdAt || 0;
    const tb = b.lastUpdatedAt || b.createdAt || 0;
    return tb - ta;
  });
  return chats;
}

function getMessages(chat) {
  const editor = editors.find((e) => e.name === chat.source);
  const resolved =
    editor ||
    editors.find(
      (e) =>
        chat.source &&
        (chat.source.startsWith(e.name) || (e.sources && e.sources.includes(chat.source)))
    );
  if (!resolved) return [];
  return resolved.getMessages(chat);
}

function resetCaches() {
  for (const editor of editors) {
    if (typeof editor.resetCache === 'function') editor.resetCache();
  }
}

function detectEditors() {
  const sources = new Set();
  for (const chat of getAllChats()) {
    if (chat.source) sources.add(chat.source);
  }
  return [...sources];
}

module.exports = {
  getAllChats,
  getMessages,
  resetCaches,
  detectEditors,
  editors,
  editorLabels,
};
