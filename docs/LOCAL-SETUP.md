# Local Setup (no Docker)

Run the whole stack on your Mac with Homebrew Postgres — server, dashboard, and the
collector that sends session data. Four parts; keep the server and dashboard running in
their own terminals.

**Prereqs:** Node ≥ 20.19, PostgreSQL (`brew install postgresql@16`), and `npm install`
run once in the repo root.

> The server reads environment variables directly — it does **not** load `.env` (that file
> is only for Docker). Use the `export` lines below in each terminal that runs a server
> command, or prefix them inline.

---

## 1. Start the server (Terminal 1)

```bash
cd /Volumes/thalia/team-ai-collector

# One-time: start Postgres and create the database
brew services start postgresql@16
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb teamai 2>/dev/null || true

# Env (set once per terminal)
export DATABASE_URL="postgresql:///teamai"
export ADMIN_API_KEY="my-admin-key"
export DEVICE_TOKEN_SECRET="my-device-secret"

# Start it (creates all tables on boot)
node packages/server/src/index.js
```

`postgresql:///teamai` connects over the local socket as your macOS user (a superuser) —
no password needed. You should see `Team AI server listening on :8080`. Leave it running.

**Verify:**
```bash
curl http://localhost:8080/v1/health      # {"ok":true,...}
```

---

## 2. Create an organization (Terminal 2, one-time)

This mints the `org_api_key` used by the dashboard and every engineer. Use the **same
`DATABASE_URL`**:

```bash
cd /Volumes/thalia/team-ai-collector
DATABASE_URL="postgresql:///teamai" \
  node packages/server/scripts/bootstrap-org.js --name "Doorloom"
```

It prints `org_api_key` (e.g. `org_xxxxxxxxxxxx`) **once** — copy and save it.

---

## 3. Start the dashboard (Terminal 3)

```bash
cd /Volumes/thalia/team-ai-collector
npm run dev -w @team-ai/dashboard
```

Open **http://localhost:3000** and paste the `org_api_key`. The dashboard's Vite proxy
forwards `/v1` calls to the server on `:8080`, so the server in Terminal 1 must be running.
(Empty until you sync data in step 4.)

---

## 4. Send session data (Terminal 4)

This is the engineer side — scans local Claude Code / Cursor sessions and uploads stats.

```bash
cd /Volumes/thalia/team-ai-collector

# Log in once (saves a device token to ~/.team-ai/config.json)
node packages/collector/bin/cli.js login \
  --org http://localhost:8080 \
  --key org_xxxxxxxxxxxx \
  --email you@doorloom.com

# Scan + upload
node packages/collector/bin/cli.js connect --once
```

You'll see `✓ Synced N sessions, M messages`. Reload the dashboard to see them.

**Check status:**
```bash
node packages/collector/bin/cli.js status      # last sync, queue depth, editors
```

To keep syncing automatically in the background (no terminal needed):
```bash
node packages/collector/bin/cli.js service install
```

---

## What's running where

| Terminal | Process | Port | Notes |
|----------|---------|------|-------|
| 1 | API server | 8080 | needs the `export` env vars |
| 3 | Dashboard (Vite) | 3000 | proxies `/v1` → 8080 |
| — | Postgres | 5432 | `brew services` (runs in background) |

Terminals 2 and 4 are one-off commands, not long-running.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| `database "pawanmore" does not exist` | `DATABASE_URL` not set in that shell — `export` it or prefix the command. |
| `[vite] http proxy error: ECONNREFUSED` (port 8080) | The API server isn't running. Start Terminal 1, confirm `/v1/health`. |
| `connect` says `⚠ Sync failed (queued)` | Server unreachable; payload is queued. Start the server, re-run `connect --once`. |
| `No email…` on login | Set `git config user.email` or pass `--email you@doorloom.com`. |
| Dashboard empty | No data yet — run step 4, and make sure you pasted the right `org_api_key`. |

For Docker-based setup and the team rollout, see [RUNNING.md](RUNNING.md) and
[TEAM-ONBOARDING.md](TEAM-ONBOARDING.md).
