const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.team-ai');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  sync_interval_sec: 3600,
  privacy: { message_content: 'none' },
  projects: null,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

function clearConfig() {
  try {
    fs.unlinkSync(CONFIG_PATH);
  } catch {
    /* ignore */
  }
}

function getGitEmail() {
  const { execSync } = require('child_process');
  try {
    return execSync('git config user.email', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

module.exports = {
  CONFIG_DIR,
  CONFIG_PATH,
  DEFAULTS,
  loadConfig,
  saveConfig,
  clearConfig,
  getGitEmail,
};
