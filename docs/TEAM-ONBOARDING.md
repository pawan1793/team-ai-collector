# Team Onboarding

How to get your team sending AI coding-session data to the server — in **one command** per engineer.

There are two roles: the **admin** (you, one-time setup) and each **engineer** (one command).

---

## 1. Admin — one-time setup

### a. Start the server

```bash
cp .env.example .env
# Edit ADMIN_API_KEY and DEVICE_TOKEN_SECRET to your own secrets
docker compose up -d --build
```

Verify it's up: `curl http://localhost:8080/v1/health` → `{"ok":true,...}`

### b. Create the organization and get the team key

```bash
docker compose exec server node scripts/bootstrap-org.js --name "Your Team"
```

This prints an `org_api_key` (starts with `org_…`) **exactly once**. Save it — it's the
key every engineer uses to join, and it's also what unlocks the dashboard. If you lose it
you'll have to create a new org.

### c. Bake your server URL into `join.sh`

Edit one line in [`join.sh`](../join.sh) so engineers only have to paste a key:

```bash
DEFAULT_ORG="http://your-server:8080"   # ← your real server address
```

Commit and push. If your server isn't on localhost, put it behind HTTPS — the device
token is a Bearer credential.

### d. Share two things with the team

1. The repo URL.
2. The `org_api_key`.

---

## 2. Engineer setup

Works on **macOS, Linux, and Windows**. The collector runs on Node, so the commands are
the same everywhere — only the wrapper differs.

> **Before you start:** make sure `git config user.email` is set — that email is your
> identity in the team dashboard. Requires Node ≥ 20.19.

### macOS / Linux (and Windows with Git Bash) — one command

```bash
git clone <your-repo-url> && cd team-ai-collector
./join.sh org_xxxxxxxx
```

### Windows (PowerShell / cmd) — three commands

```powershell
git clone <your-repo-url>
cd team-ai-collector
npm install
node packages/collector/bin/cli.js login --org http://your-server:8080 --key org_xxxxxxxx
node packages/collector/bin/cli.js connect --once
```

Either way the result is the same:

1. Dependencies installed (first run only).
2. Logged in — a device token is saved to `~/.team-ai/config.json` (mode `0600`).
3. Local sessions scanned and the first batch uploaded.

### Send new sessions later

Re-run `./join.sh org_xxxxxxxx` (or `node packages/collector/bin/cli.js connect --once`)
any time, **or** set up background auto-sync below.

### Auto-sync in the background (recommended)

One cross-platform command registers the collector with your OS's native scheduler —
no cron, no terminal left open. Run it once after logging in:

```bash
node packages/collector/bin/cli.js service install
# or: npm run service -- install
```

| OS | Mechanism | Behavior |
|----|-----------|----------|
| macOS | launchd LaunchAgent | runs the built-in hourly loop, kept alive, restarts on login/reboot |
| Linux | systemd `--user` service | same loop, `Restart=always`, starts on login |
| Windows | Task Scheduler task | runs one sync per hour |

Manage it:

```bash
node packages/collector/bin/cli.js service status
node packages/collector/bin/cli.js service uninstall
```

macOS/Linux log to `~/.team-ai/agent.log`. Log in once (above) before installing.

### Check it worked

```bash
node packages/collector/bin/cli.js status
# or: npm run collector:status
```

Shows last sync time, pending queue depth, and which editors were detected
(Claude Code, Cursor).

---

## What gets uploaded

**Only aggregate usage statistics — no message text.** Per session: message counts by
role, models used, tool-call names, token totals, and char counts. This is the default
and is enforced on both the client and the server.

If your org later opts into message content (`redacted` or `full` policy), it must be
changed in **both** the org policy and each engineer's config — otherwise the server
rejects message bodies.

---

## Command reference

All `node packages/collector/bin/cli.js <cmd>` calls work on macOS, Linux, and Windows.

| Command | What it does |
|---------|--------------|
| `./join.sh <key>` | Install + login + first sync (macOS/Linux/Git Bash) |
| `... cli.js login --org URL --key <key>` | Log in (the Windows-native first step) |
| `... cli.js connect --once` / `npm run sync` | Upload latest sessions |
| `... cli.js service install` | Background auto-sync, native to your OS |
| `... cli.js service status` / `uninstall` | Check or remove background sync |
| `... cli.js status` / `npm run collector:status` | Show last sync, queue depth, editors |
| `... cli.js scan` | Scan locally **without** uploading |
| `... cli.js logout` | Remove the saved device token |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Not logged in` | Run `./join.sh <key>` first. |
| `Login failed` | Check the server URL in `join.sh` and that the key is correct/current. |
| `No email…` | Set `git config user.email`, or run login with `--email you@company.com`. |
| Sync says "queued" | Server was unreachable; the payload is queued and retried on the next run. Check `status` for queue depth. |
| `Editors detected: none` | You have no local Claude Code / Cursor sessions yet, or they're in a non-standard location. |
| `RATE_LIMITED` | More than 120 syncs/hour from one device — back off; hourly cron is plenty. |

See also: [RUNNING.md](RUNNING.md) for full server/dev details.
