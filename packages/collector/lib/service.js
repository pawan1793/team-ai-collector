/**
 * Cross-platform background sync installer.
 *
 * Registers the collector to sync automatically using each OS's native
 * scheduler — no cron, no terminal left open:
 *   - macOS   → launchd LaunchAgent (runs the built-in `connect` loop, KeepAlive)
 *   - Linux   → systemd --user service (`connect` loop, Restart=always)
 *   - Windows → Task Scheduler hourly task (`connect --once`)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const { CONFIG_DIR, CONFIG_PATH } = require('./config');

const LABEL = 'com.team-ai.collector';
const WIN_TASK = 'TeamAICollector';
const NODE_BIN = process.execPath;
const CLI_PATH = path.join(__dirname, '..', 'bin', 'cli.js');
const LOG_PATH = path.join(CONFIG_DIR, 'agent.log');

function ensureLoggedIn() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error('Not logged in. Run login first (or ./join.sh <key>).');
  }
}

// ── macOS (launchd) ───────────────────────────────────────────────────────────

function macPlistPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function macInstall() {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${CLI_PATH}</string>
    <string>connect</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_PATH}</string>
  <key>StandardErrorPath</key><string>${LOG_PATH}</string>
</dict>
</plist>
`;
  const p = macPlistPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, plist);
  try { execSync(`launchctl unload "${p}"`, { stdio: 'ignore' }); } catch {}
  execSync(`launchctl load "${p}"`);
  return `LaunchAgent loaded. Logs: ${LOG_PATH}`;
}

function macUninstall() {
  const p = macPlistPath();
  try { execSync(`launchctl unload "${p}"`, { stdio: 'ignore' }); } catch {}
  try { fs.unlinkSync(p); } catch {}
  return 'LaunchAgent removed.';
}

function macStatus() {
  try {
    const out = execSync('launchctl list', { encoding: 'utf-8' });
    return out.includes(LABEL) ? 'running' : 'not installed';
  } catch { return 'unknown'; }
}

// ── Linux (systemd --user) ────────────────────────────────────────────────────

function linuxUnitPath() {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'team-ai-collector.service');
}

function linuxInstall() {
  const unit = `[Unit]
Description=Team AI Collector background sync

[Service]
ExecStart=${NODE_BIN} ${CLI_PATH} connect
Restart=always
RestartSec=30

[Install]
WantedBy=default.target
`;
  const p = linuxUnitPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, unit);
  execSync('systemctl --user daemon-reload');
  execSync('systemctl --user enable --now team-ai-collector.service');
  // Keep running when the user is logged out (best-effort; needs sudo on some distros)
  try { execSync(`loginctl enable-linger ${os.userInfo().username}`, { stdio: 'ignore' }); } catch {}
  return 'systemd --user service enabled and started.';
}

function linuxUninstall() {
  try { execSync('systemctl --user disable --now team-ai-collector.service', { stdio: 'ignore' }); } catch {}
  try { fs.unlinkSync(linuxUnitPath()); } catch {}
  try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch {}
  return 'systemd service removed.';
}

function linuxStatus() {
  try {
    const out = execSync('systemctl --user is-active team-ai-collector.service', { encoding: 'utf-8' }).trim();
    return out === 'active' ? 'running' : out;
  } catch { return 'not installed'; }
}

// ── Windows (Task Scheduler) ──────────────────────────────────────────────────

function winInstall() {
  // Hourly task that runs one sync cycle. /F overwrites an existing task.
  const tr = `\\"${NODE_BIN}\\" \\"${CLI_PATH}\\" connect --once`;
  execFileSync('schtasks', [
    '/Create', '/TN', WIN_TASK, '/TR', tr, '/SC', 'HOURLY', '/F',
  ], { stdio: 'ignore' });
  // Kick off the first run now.
  try { execFileSync('schtasks', ['/Run', '/TN', WIN_TASK], { stdio: 'ignore' }); } catch {}
  return `Scheduled task "${WIN_TASK}" created (hourly).`;
}

function winUninstall() {
  try { execFileSync('schtasks', ['/Delete', '/TN', WIN_TASK, '/F'], { stdio: 'ignore' }); } catch {}
  return 'Scheduled task removed.';
}

function winStatus() {
  try {
    execFileSync('schtasks', ['/Query', '/TN', WIN_TASK], { stdio: 'ignore' });
    return 'installed';
  } catch { return 'not installed'; }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

const HANDLERS = {
  darwin: { install: macInstall, uninstall: macUninstall, status: macStatus },
  linux: { install: linuxInstall, uninstall: linuxUninstall, status: linuxStatus },
  win32: { install: winInstall, uninstall: winUninstall, status: winStatus },
};

function installService(action) {
  const h = HANDLERS[process.platform];
  if (!h) throw new Error(`Unsupported platform: ${process.platform}`);
  if (action === 'install') ensureLoggedIn();
  const fn = h[action];
  if (!fn) throw new Error(`Unknown action: ${action} (use install|uninstall|status)`);
  return fn();
}

module.exports = { installService };
