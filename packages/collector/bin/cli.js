#!/usr/bin/env node
const chalk = require('chalk');
const { Command } = require('commander');
const {
  loadConfig,
  saveConfig,
  clearConfig,
  getGitEmail,
  DEFAULTS,
  ALLOWED_ACCOUNTS,
  isValidAccount,
} = require('../lib/config');
const { initDb, getDb, getMeta, setMeta } = require('../lib/db');
const { scanAll, normalizeFolder } = require('../lib/scanner');
const { runSyncCycle, deviceLogin } = require('../lib/sync');
const { installService } = require('../lib/service');
const { detectEditors, getAllChats } = require('@team-ai/adapters');

const program = new Command();
program.name('team-ai-collector').description('Team AI usage collector').version('0.1.0');

function prompt(question) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

// Show detected project folders and let the user pick which to sync.
// Returns an array of folder paths, or null to sync all folders.
async function selectProjects() {
  const folders = [
    ...new Set(getAllChats().map((c) => normalizeFolder(c.folder)).filter(Boolean)),
  ].sort();

  if (folders.length === 0) {
    console.log(chalk.dim('  No project folders detected; syncing all sessions.'));
    return null;
  }

  console.log(chalk.bold('\n  Projects found:'));
  folders.forEach((f, i) => console.log(`    ${chalk.cyan(i + 1)}. ${f}`));
  const answer = (
    await prompt(chalk.dim('  Enter comma-separated numbers (e.g. 1,2,3) or "all": '))
  ).trim();

  if (!answer || answer.toLowerCase() === 'all') return null;

  const selected = [
    ...new Set(
      answer
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= folders.length)
        .map((n) => folders[n - 1])
    ),
  ];

  if (selected.length === 0) {
    console.log(chalk.yellow('  No valid selection; syncing all sessions.'));
    return null;
  }
  return selected;
}

program
  .command('login')
  .description('Authenticate and save device token')
  .requiredOption('--org <url>', 'API base URL')
  .requiredOption('--key <apiKey>', 'Organization API key')
  .option('--email <email>', 'User email (default: git config user.email)')
  .option('--device-name <name>', 'Device label')
  .action(async (opts) => {
    const email = opts.email || getGitEmail();
    if (!email) {
      console.error(chalk.red('No email. Use --email or set git config user.email'));
      process.exit(1);
    }
    try {
      const auth = await deviceLogin(opts.org, opts.key, email, opts.deviceName);
      const projects = await selectProjects();
      saveConfig({
        api_base: opts.org.replace(/\/$/, ''),
        org_id: auth.org_id,
        user_id: auth.user_id,
        user_email: email,
        device_id: auth.device_id,
        device_token: auth.device_token,
        org_api_key: opts.key,
        ...DEFAULTS,
        projects,
      });
      // Reset the sync cursor so the chosen project selection takes full effect:
      // older sessions in newly-selected folders re-sync on the next connect.
      initDb();
      setMeta('cursor_since', '0');
      console.log(chalk.green('✓ Logged in'));
      console.log(chalk.dim(`  org: ${auth.org_id}  user: ${auth.user_id}`));
      console.log(
        chalk.dim(
          `  Projects: ${projects ? `${projects.length} selected` : 'all'}`
        )
      );
      console.log(
        chalk.dim(
          '  Privacy: message_content=full by default. Run connect to start syncing.'
        )
      );
    } catch (err) {
      console.error(chalk.red(`Login failed: ${err.message}`));
      process.exit(1);
    }
  });

program.command('logout').action(() => {
  clearConfig();
  console.log(chalk.green('✓ Logged out'));
});

program
  .command('connect')
  .description('Start sync loop')
  .option('--once', 'Run a single sync cycle')
  .option('--interval <sec>', 'Override sync interval', (v) => parseInt(v, 10))
  .option('--account <name>', `Internal account name (allowed: ${ALLOWED_ACCOUNTS.join(', ')})`)
  .action(async (opts) => {
    const config = loadConfig();
    if (!config?.device_token) {
      console.error(chalk.red('Not logged in. Run: team-ai-collector login --org URL --key KEY'));
      process.exit(1);
    }

    // Feature 3: resolve + validate the account (strict-once — required until saved, then remembered).
    if (opts.account != null) {
      if (!isValidAccount(opts.account)) {
        console.error(
          chalk.red(
            `Invalid account "${opts.account}". Allowed values: ${ALLOWED_ACCOUNTS.join(', ')}`
          )
        );
        process.exit(1);
      }
      config.account = opts.account;
      saveConfig({ ...config });
    }
    if (!config.account) {
      console.error(
        chalk.red(
          `An account is required. Run: team-ai-collector connect --account <${ALLOWED_ACCOUNTS.join('|')}>`
        )
      );
      process.exit(1);
    }

    initDb();
    const intervalSec = opts.interval || config.sync_interval_sec || 3600;

    console.log(chalk.bold('\n  Team AI Collector'));
    console.log(chalk.dim(`  Sync every ${intervalSec}s`));
    const editors = detectEditors();
    console.log(chalk.dim(`  Editors detected: ${editors.join(', ') || 'none'}`));
    console.log('');

    const run = async () => {
      try {
        const result = await runSyncCycle(config);
        console.log(
          chalk.green(
            `  ✓ Synced ${result.accepted?.sessions ?? 0} sessions, ${result.accepted?.messages ?? 0} messages`
          )
        );
      } catch (err) {
        console.log(chalk.yellow(`  ⚠ Sync failed (queued): ${err.message}`));
      }
    };

    await run();
    if (opts.once) return;

    setInterval(run, intervalSec * 1000);
  });

program.command('scan').action(() => {
  initDb();
  const result = scanAll((p) => {
    process.stdout.write(`\r  Scanning ${p.scanned}/${p.total}...`);
  });
  console.log(`\n${chalk.green('✓ Scan complete')}`);
  console.log(chalk.dim(`  ${result.analyzed} analyzed, ${result.skipped} skipped, ${result.total} total`));
});

program.command('status').action(() => {
  const config = loadConfig();
  if (!config) {
    console.log(chalk.yellow('Not configured. Run login first.'));
    return;
  }
  initDb();
  const lastSync = getMeta('last_sync_at');
  const err = getMeta('last_sync_error');
  const queue = getDb().prepare('SELECT COUNT(*) as c FROM outbound_queue').get().c;
  console.log(chalk.bold('\n  Status'));
  console.log(`  API:     ${config.api_base}`);
  console.log(`  Org:     ${config.org_id}`);
  console.log(`  Email:   ${config.user_email}`);
  console.log(`  Privacy: message_content=${config.privacy?.message_content || 'none'}`);
  console.log(
    `  Last sync: ${lastSync ? new Date(parseInt(lastSync, 10)).toISOString() : 'never'}`
  );
  console.log(`  Queue:   ${queue} pending`);
  if (err) console.log(chalk.yellow(`  Error:   ${err}`));
  console.log(`  Editors: ${detectEditors().join(', ') || 'none'}`);
});

program
  .command('service')
  .description('Manage background auto-sync (macOS launchd / Linux systemd / Windows Task Scheduler)')
  .argument('<action>', 'install | uninstall | status')
  .action((action) => {
    try {
      const result = installService(action);
      if (action === 'status') {
        console.log(`  Background sync: ${result}`);
      } else {
        console.log(chalk.green(`✓ ${result}`));
      }
    } catch (err) {
      console.error(chalk.red(err.message));
      process.exit(1);
    }
  });

program.parse();
