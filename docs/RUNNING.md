# Running Team AI Collector

This guide covers prerequisites, server deployment, engineer CLI setup, the manager dashboard, verification, and troubleshooting.

---

## Table of contents

1. [What you are running](#what-you-are-running)
2. [Prerequisites](#prerequisites)
3. [Option A — Docker Compose (recommended)](#option-a--docker-compose-recommended)
4. [Option B — Local development](#option-b--local-development)
5. [Create an organization](#create-an-organization)
6. [Engineer CLI (collector)](#engineer-cli-collector)
7. [Manager dashboard](#manager-dashboard)
8. [API reference (quick)](#api-reference-quick)
9. [Cron / background sync](#cron--background-sync)
10. [Verification and tests](#verification-and-tests)
11. [Troubleshooting](#troubleshooting)
12. [Environment variables](#environment-variables)

---

## What you are running

Three components work together:

| Component | Role | Default URL |
|-----------|------|-------------|
| **Server** | Ingest API + team read API + Postgres | `http://localhost:8080` |
| **Dashboard** | Manager KPI UI (7-day overview, members) | `http://localhost:3000` |
| **Collector CLI** | Runs on each engineer’s Mac; scans Claude/Cursor, uploads hourly | N/A (local) |

Data flow:

```
~/.claude, ~/.cursor  →  collector scan  →  ~/.team-ai/cache.db
                                              ↓ POST /v1/sync (hourly)
                                         Postgres (server)
                                              ↓ GET /v1/team/*
                                         Dashboard
```

**Privacy default:** organizations are created with `message_content: none` — only session metadata and token stats are stored, not chat bodies.

---

## Prerequisites

### For Docker Compose (server + dashboard)

- **Docker** and **Docker Compose** v2
- Ports **5432**, **8080**, and **3000** available on the host (5432 only if you need host access to Postgres)

### For collector CLI (engineer machines)

- **macOS 13+** (MVP adapters target macOS paths)
- **Node.js ≥ 20.19** ([nodejs.org](https://nodejs.org/) or `nvm install 20`)
- **Xcode Command Line Tools** (for native `better-sqlite3` build): `xcode-select --install`
- **Git** with `user.email` set (used as default identity), or pass `--email` on login
- At least one supported editor with local data:
  - **Claude Code** — `~/.claude/projects/`
  - **Cursor** — `~/.cursor/chats/` and Cursor app data

### For local server dev (without Docker)

- **PostgreSQL 15+** listening on `localhost:5432`
- Node.js ≥ 20.19

---

## Option A — Docker Compose (recommended)

Best for a pilot team: one host runs Postgres, API, and dashboard.

### 1. Clone and configure

```bash
cd /path/to/team-ai-collector
cp .env.example .env
```

Edit `.env` and set strong secrets (do not use defaults in production):

```bash
ADMIN_API_KEY=your-long-random-admin-key
DEVICE_TOKEN_SECRET=your-long-random-device-secret
POSTGRES_PASSWORD=your-db-password
```

`DEVICE_TOKEN_SECRET` is used to hash device tokens issued at login. `ADMIN_API_KEY` protects org creation endpoints.

### 2. Start the stack

```bash
docker compose up -d --build
```

Wait until services are healthy:

```bash
docker compose ps
curl -s http://localhost:8080/v1/health
# Expected: {"ok":true,"time":...}
```

### 3. Create an organization

```bash
docker compose exec server node scripts/bootstrap-org.js --name "Acme Engineering"
```

**Save the output.** It prints JSON including `org_api_key` — shown **once**. You need it for:

- Engineer `login --key`
- Dashboard “Organization API key” field

Example output:

```json
{
  "org_id": "org_abc123def456",
  "name": "Acme Engineering",
  "org_api_key": "org_xxxxxxxxxxxxxxxxxxxxxxxx",
  "policies": {
    "message_content": "none",
    "hash_project_paths": false,
    "retention_days": 90
  }
}
```

Alternative (HTTP, requires `ADMIN_API_KEY` from `.env`):

```bash
curl -s -X POST http://localhost:8080/v1/admin/orgs \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your-long-random-admin-key" \
  -d '{"name":"Acme Engineering"}'
```

### 4. Open the dashboard

- URL: **http://localhost:3000**
- Paste the **org API key** from step 3 and click **Load**

The dashboard proxies API calls to the server via nginx (`/v1/...`).

### 5. Stop / reset

```bash
# Stop containers (keep data)
docker compose down

# Stop and delete Postgres volume (destructive)
docker compose down -v
```

---

## Option B — Local development

Use this when iterating on server or collector code without rebuilding images.

### 1. Install dependencies

```bash
cd /path/to/team-ai-collector
npm install
```

### 2. Start PostgreSQL

Ensure Postgres is running. Example with Homebrew:

```bash
brew services start postgresql@16
```

Create a database (optional; e2e uses default `postgres` DB):

```bash
createdb teamai
```

### 3. Configure environment

```bash
export DATABASE_URL=postgresql://localhost:5432/teamai
export ADMIN_API_KEY=dev-admin-key
export DEVICE_TOKEN_SECRET=dev-device-secret
export DEFAULT_MESSAGE_CONTENT=none
export PORT=8080
```

Or add these to a local `.env` and `source` them before starting the server.

### 4. Start the API server

```bash
node packages/server/src/index.js
```

Migrations in `migrations/001_initial.sql` run automatically on startup.

Bootstrap org (separate terminal):

```bash
npm run bootstrap:org -- --name "Local Dev Org"
```

### 5. Start the dashboard (dev mode)

```bash
cd packages/dashboard
npm run dev
```

Open **http://localhost:3000**. Vite proxies `/v1` to `http://localhost:8080` (see `packages/dashboard/vite.config.js`).

Production build:

```bash
npm run build -w @team-ai/dashboard
# Static files in packages/dashboard/dist/
```

---

## Create an organization

Every deployment needs at least one org row in Postgres.

| Method | When to use |
|--------|-------------|
| `docker compose exec server node scripts/bootstrap-org.js` | Docker Compose |
| `npm run bootstrap:org -- --name "..."` | Local server (`DATABASE_URL` set) |
| `POST /v1/admin/orgs` with `X-Admin-Key` | Automation / CI |

Each org gets:

- `org_id` — tenant identifier
- `org_api_key` — shared secret for device login and dashboard reads
- `policies.message_content` — default `none` unless overridden

---

## Engineer CLI (collector)

Runs on each team member’s machine. It does **not** need Docker.

### 1. Install (from repo)

```bash
cd /path/to/team-ai-collector
npm install
```

Optional global-style alias:

```bash
npm link -w team-ai-collector
# Then: team-ai-collector status
```

Or invoke directly:

```bash
node packages/collector/bin/cli.js <command>
```

### 2. Login

Use the **API base URL** reachable from the engineer’s machine and the **org API key** from bootstrap.

**Docker on same machine:**

```bash
node packages/collector/bin/cli.js login \
  --org http://localhost:8080 \
  --key org_xxxxxxxxxxxxxxxxxxxxxxxx
```

**Docker on a team server** (replace host):

```bash
node packages/collector/bin/cli.js login \
  --org https://team-ai.internal.acme.com \
  --key org_xxxxxxxxxxxxxxxxxxxxxxxx \
  --email alice@acme.com
```

Login:

1. Calls `POST /v1/auth/device` with org key + email
2. Receives `device_token`, `user_id`, `org_id`, `device_id`
3. Writes `~/.team-ai/config.json` with mode **0600**

Verify:

```bash
node packages/collector/bin/cli.js status
```

### 3. Scan locally (no upload)

Useful to confirm adapters see Claude/Cursor data:

```bash
node packages/collector/bin/cli.js scan
```

This populates `~/.team-ai/cache.db` only.

### 4. Sync to server

Every connect must be tied to an **internal account**. Allowed values: `vibe2`, `vibe3`,
`info`, `vibe4`, `vibe5`. Pass `--account` the first time; it is saved to
`~/.team-ai/config.json` and reused on subsequent runs (no need to repeat the flag).

```bash
node packages/collector/bin/cli.js connect --account vibe2 --once
```

Existing installs created before this change keep working, but must run `connect --account <name>`
once to record their account (they appear with a blank account on the dashboard until then).

**Single sync** (good for testing or cron):

```bash
node packages/collector/bin/cli.js connect --once            # reuses saved account
node packages/collector/bin/cli.js connect --account vibe3 --once
```

**Continuous hourly loop** (MVP default interval 3600 seconds):

```bash
node packages/collector/bin/cli.js connect --account vibe2
```

**Custom interval** (e.g. 30 minutes):

```bash
node packages/collector/bin/cli.js connect --account vibe2 --interval 1800
```

The account is included in every sync payload and stored on the user server-side, where it can
be filtered and displayed on the dashboard.

Each cycle:

1. Rescans editors → local SQLite
2. Builds payload for sessions updated since last cursor
3. `POST /v1/sync` with Bearer device token
4. On failure, queues payload in `outbound_queue` for retry

### 5. Logout

```bash
node packages/collector/bin/cli.js logout
```

Removes `~/.team-ai/config.json` (does not revoke server-side device row in MVP).

---

## Manager dashboard

### Docker

1. Open **http://localhost:3000**
2. Enter **Organization API key** (`org_...`)
3. Click **Load**

Shows last **7 days**: active members, sessions, messages, token totals, per-member table.

### Local dev

1. Start server on `:8080`
2. `npm run dev -w @team-ai/dashboard`
3. Open **http://localhost:3000** and enter org key

The key is stored in `localStorage` in the browser only.

---

## API reference (quick)

Base URL: `http://localhost:8080` (or your deployed host).

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /v1/health` | None | Liveness |
| `POST /v1/auth/device` | Body: `org_api_key`, `email` | Issue device token |
| `POST /v1/sync` | `Authorization: Bearer <device_token>`, `X-Org-Id` | Ingest telemetry |
| `GET /v1/team/overview?from=&to=` | `X-Org-Api-Key` | Team KPIs |
| `GET /v1/team/members?from=&to=` | `X-Org-Api-Key` | Per-user rollups |
| `GET /v1/team/sessions?from=&to=&limit=&offset=` | `X-Org-Api-Key` | Session list |
| `POST /v1/admin/orgs` | `X-Admin-Key` | Create org |

Full sketch: [openapi.yaml](./openapi.yaml).

### Example: manual sync with curl

After login, if you have `device_token`, `org_id`, `user_id`, `device_id`:

```bash
curl -X POST http://localhost:8080/v1/sync \
  -H "Authorization: Bearer YOUR_DEVICE_TOKEN" \
  -H "X-Org-Id: YOUR_ORG_ID" \
  -H "X-Schema-Version: 1.0" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": "1.0",
    "sync_id": "550e8400-e29b-41d4-a716-446655440000",
    "sent_at": 1716003600000,
    "client": {"name":"team-ai-collector","version":"0.1.0","platform":"darwin"},
    "user": {"user_id":"usr_xxx","email":"you@acme.com","device_id":"dev_xxx"},
    "cursor": {"since": 0},
    "sessions": [],
    "session_stats": [],
    "messages": []
  }'
```

---

## Cron / background sync

MVP is designed for **hourly** sync. On each Mac:

```cron
0 * * * * cd /path/to/team-ai-collector && /usr/local/bin/node packages/collector/bin/cli.js connect --once >> ~/.team-ai/sync.log 2>&1
```

Ensure the user has run `login` once so `~/.team-ai/config.json` exists.

For a long-running daemon instead of cron:

```bash
nohup node packages/collector/bin/cli.js connect >> ~/.team-ai/sync.log 2>&1 &
```

---

## Verification and tests

### Health check

```bash
curl -s http://localhost:8080/v1/health | jq .
```

### Adapter unit tests

```bash
npm test -w @team-ai/adapters
```

### End-to-end smoke (local Postgres, no Docker)

Requires Postgres on `localhost:5432`:

```bash
npm run e2e
```

This starts the server temporarily, creates an org, authenticates a device, syncs a session, checks idempotency and message policy (`403` when sending bodies with `message_content: none`).

### Docker E2E (when Docker is installed)

```bash
npm run e2e:docker
```

### Integration tests (server against running API)

```bash
# Server must be running with matching ADMIN_API_KEY
RUN_INTEGRATION_TESTS=1 npm run test:integration
```

---

## Troubleshooting

### `better-sqlite3` install fails on macOS

```bash
xcode-select --install
npm rebuild better-sqlite3
```

### Collector: “Not logged in”

Run `login` with correct `--org` (no trailing path except optional `/`) and `--key`.

### Collector: “No email”

```bash
git config --global user.email "you@acme.com"
# or
node packages/collector/bin/cli.js login ... --email you@acme.com
```

### Collector: “Sync failed (queued)”

- Check server is up: `curl http://localhost:8080/v1/health`
- Check `status` for `last_sync_error`
- Failed payloads sit in `outbound_queue` inside `~/.team-ai/cache.db` and retry next cycle

### Collector: no sessions found

- Confirm Claude Code or Cursor has been used on this machine
- Run `scan` and check paths in [GREENFIELD-REFERENCE-PACK.md](./GREENFIELD-REFERENCE-PACK.md) (Data paths section)
- MVP is **macOS-only** for adapters

### Dashboard: “Load” fails / 401

- Wrong or expired org API key
- Server not reachable from browser (use `http://localhost:8080` for local dev; Docker dashboard proxies via nginx)

### Docker: server exits / DB connection refused

```bash
docker compose logs server
docker compose logs postgres
```

Ensure Postgres healthcheck passed before server starts.

### `POST /v1/sync` returns 403 POLICY_VIOLATION

Org policy is `message_content: none` but the client sent `messages[]`. Collector default omits bodies; do not set `privacy.message_content` to `full` unless the org allows it.

### Port conflicts

| Port | Service |
|------|---------|
| 5432 | Postgres |
| 8080 | API server |
| 3000 | Dashboard |

Change mappings in `docker-compose.yml` if needed.

---

## Environment variables

### Server (`packages/server`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | Postgres connection string |
| `PORT` | No | `8080` | HTTP listen port |
| `ADMIN_API_KEY` | Yes (prod) | `change-me-admin-key` | Protects `POST /v1/admin/orgs` |
| `DEVICE_TOKEN_SECRET` | Yes (prod) | `change-me-device-secret` | HMAC secret for device tokens |
| `DEFAULT_MESSAGE_CONTENT` | No | `none` | Policy for new orgs: `none`, `redacted`, `full` |

### Docker Compose (`.env`)

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` | DB user (default `teamai`) |
| `POSTGRES_PASSWORD` | DB password |
| `POSTGRES_DB` | Database name |
| `ADMIN_API_KEY` | Passed to server |
| `DEVICE_TOKEN_SECRET` | Passed to server |

### Collector (local only)

Stored in `~/.team-ai/config.json` after login — not env vars:

| Field | Description |
|-------|-------------|
| `api_base` | Server URL |
| `org_id` | Organization |
| `device_token` | Bearer token for sync |
| `user_id`, `device_id`, `user_email` | Identity |
| `sync_interval_sec` | Default `3600` |
| `privacy.message_content` | Default `none` |

### Dashboard build

| Variable | Description |
|----------|-------------|
| `VITE_API_BASE` | API origin for browser (empty in Docker = same-origin proxy) |

---

## Typical pilot rollout checklist

1. [ ] Deploy Compose on a team VM; set strong `.env` secrets  
2. [ ] `bootstrap-org.js` → distribute `org_api_key` to managers (dashboard)  
3. [ ] Share collector install instructions + `login` command with engineers  
4. [ ] Each engineer runs `connect --once` then `status` to verify  
5. [ ] Manager confirms KPIs on dashboard after first hourly sync  
6. [ ] Optional: add cron for `connect --once` on engineer laptops  

For product behavior and roadmap, see [PRD-team-ai-usage-collector.md](./PRD-team-ai-usage-collector.md). For Phase 2 (30s sync, more editors), see [PHASE2-DEFERRED.md](./PHASE2-DEFERRED.md).
