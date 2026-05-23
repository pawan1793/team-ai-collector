# Greenfield Reference Pack

Use this document when copying Agentlytics prior art into a **new team AI usage collector** repo. Pair with [PRD-team-ai-usage-collector.md](./PRD-team-ai-usage-collector.md).

**Source repo:** `agentlytics` (this tree)  
**License:** ISC — if you copy source files, retain copyright notices and license per file/package.

---

## Quick copy (automated)

From the Agentlytics repo root:

```bash
# Default target: ../team-ai-collector
./scripts/copy-greenfield-references.sh

# Custom target
./scripts/copy-greenfield-references.sh /path/to/team-ai-collector
```

This creates `references/agentlytics/` in the target with tiered files + this manifest + the PRD.

---

## Suggested greenfield layout

```
team-ai-collector/
├── docs/
│   ├── PRD-team-ai-usage-collector.md      # product spec (from agentlytics/docs)
│   └── GREENFIELD-REFERENCE-PACK.md        # this file
├── references/
│   └── agentlytics/                        # read-only snapshots (optional)
│       ├── relay-client.js
│       ├── relay-server.js
│       └── ...
├── packages/
│   ├── collector/                          # terminal CLI (your product)
│   ├── adapters/                           # fork or extract editors/*
│   └── server/                             # POST /v1/sync, dashboard API
└── README.md
```

**Map PRD concepts → Agentlytics files:**

| Your product | Closest Agentlytics reference |
|--------------|-------------------------------|
| Collector scan + stats | `cache.js` (`analyzeAndStore`, `scanAll`) |
| Editor adapters | `editors/*.js`, `editors/index.js`, `editors/base.js` |
| Hourly / 30s upload client | `relay-client.js` |
| Ingest API + team DB | `relay-server.js` (`POST /relay/sync`, team-stats) |
| Manager dashboard API | `server.js` + `cache.getCachedOverview` etc. |
| Team UI (relay mode) | `ui/src/pages/RelayDashboard.jsx`, `RelayUserDetail.jsx` |
| Cost estimates (v1) | `pricing.js`, `pricing.json`, `cache.estimateCosts` |
| Sandboxed scan only | `mod.ts` |
| MCP over team data (v2) | `mcp-server.js` |

---

## Tier 1 — Copy first (core pipeline)

These are the minimum references for **collect → analyze → sync → ingest**.

| File | Lines / symbols (approx) | Why you need it |
|------|--------------------------|-----------------|
| [docs/PRD-team-ai-usage-collector.md](./PRD-team-ai-usage-collector.md) | full | Your product spec |
| [cache.js](../cache.js) | `89–189` schema, `241–319` `analyzeAndStore`, `321–397` `scanAll` | Canonical **session stats** computation + SQLite schema |
| [editors/base.js](../editors/base.js) | `36–44` adapter contract, `getAppDataPath` | Adapter interface + cross-platform paths |
| [editors/index.js](../editors/index.js) | `getAllChats`, `getMessages`, `resetCaches` | Registry pattern |
| [editors/claude.js](../editors/claude.js) | full | Simplest MVP adapter (JSONL) |
| [editors/cursor.js](../editors/cursor.js) | full | High-value MVP adapter (SQLite + blobs) |
| [relay-client.js](../relay-client.js) | `9` `SYNC_INTERVAL_MS`, `115–176` `collectProjectData`, `181–224` `postToRelay`, `277–302` sync loop | **Client upload loop** (change interval to 3600 for MVP) |
| [relay-server.js](../relay-server.js) | `23–70` schema, `88–100` auth, `242–319` `POST /relay/sync`, `123–220` team-stats | **Server ingest** template for `POST /v1/sync` |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | § Database Schema, § Adding a New Editor, per-editor paths | On-disk formats for each agent |
| [package.json](../package.json) | `dependencies` | `better-sqlite3`, `express`, `chalk` versions |

### PRD ↔ Relay sync payload mapping

| PRD field (`/v1/sync`) | Relay field (`POST /relay/sync`) |
|------------------------|----------------------------------|
| `user.email` / `user_id` | `username` (body) |
| `sessions[]` | `chats[]` (`id`, `source`, `name`, …) |
| `session_stats[]` | `stats[]` (`chat_id`, tokens, `tool_calls`, `models`) |
| `messages[]` | `messages[]` (`chat_id`, `seq`, `role`, `content`) |
| `sync_id` | *(add in greenfield — relay lacks idempotency key)* |
| `cursor.since` | *(add in greenfield — relay sends project-scoped full collect)* |

---

## Tier 2 — Copy for server dashboard & analytics

| File | Key exports / routes | Why |
|------|----------------------|-----|
| [server.js](../server.js) | `GET /api/overview`, `/api/chats`, `/api/dashboard-stats`, `/api/projects`, `/api/deep-analytics` | REST patterns for **team dashboard** (adapt to Postgres) |
| [cache.js](../cache.js) | `getCachedOverview` ~464, `getCachedDashboardStats` ~893, `getCachedDeepAnalytics` ~566, `getCachedProjects` ~687 | SQL aggregation logic to port |
| [pricing.js](../pricing.js) + [pricing.json](../pricing.json) | `estimateCost`, model keys | Token → USD (v1) |
| [API.md](../API.md) | full | Request/response shapes for local API (rename to `/v1/team/*`) |
| [index.js](../index.js) | `52–146` relay/join modes, `287–318` editor detection, scan loop | CLI entry patterns |

---

## Tier 3 — Optional references

| File | Use when |
|------|----------|
| [editors/vscode.js](../editors/vscode.js) | Supporting Copilot / VS Code |
| [editors/codex.js](../editors/codex.js) | Codex CLI JSONL + token events |
| [editors/windsurf.js](../editors/windsurf.js) | ConnectRPC / LS (app must run) |
| [editors/opencode.js](../editors/opencode.js) | SQLite session DB |
| [editors/copilot.js](../editors/copilot.js) | Copilot session-state dirs |
| [editors/zed.js](../editors/zed.js) | zstd + threads.db |
| [editors/antigravity.js](../editors/antigravity.js) | Same family as Windsurf |
| [editors/gemini.js](../editors/gemini.js), [goose.js](../editors/goose.js), [kiro.js](../editors/kiro.js), etc. | Later editor support |
| [mod.ts](../mod.ts) | Zero-dep scan / JSON export without SQLite |
| [mcp-server.js](../mcp-server.js) | Team search MCP (v2 enterprise) |
| [relay-server.js](../relay-server.js) | `GET /relay/search`, `/relay/activity/:username`, `/relay/session/:id` |
| [share-image.js](../share-image.js) | OG/share cards (low priority) |
| [sync-pricing.js](../sync-pricing.js) | Maintenance script for pricing.json |
| [deno.json](../deno.json) | Deno tasks for `mod.ts` |

---

## Tier 4 — UI references (if building web dashboard)

| File | Purpose |
|------|---------|
| [ui/src/lib/api.js](../ui/src/lib/api.js) | `293–342` relay API client (`team-stats`, `activity`, `search`, `session`) |
| [ui/src/lib/constants.js](../ui/src/lib/constants.js) | `EDITOR_COLORS`, `EDITOR_LABELS` |
| [ui/src/pages/RelayDashboard.jsx](../ui/src/pages/RelayDashboard.jsx) | Team KPI layout |
| [ui/src/pages/RelayUserDetail.jsx](../ui/src/pages/RelayUserDetail.jsx) | Per-member drill-down |
| [ui/src/pages/Sessions.jsx](../ui/src/pages/Sessions.jsx) | Session list + filters |
| [ui/src/pages/Dashboard.jsx](../ui/src/pages/Dashboard.jsx) | Local dashboard KPIs (reuse charts) |
| [ui/src/pages/CostAnalysis.jsx](../ui/src/pages/CostAnalysis.jsx) | Cost views |
| [ui/src/components/KpiCard.jsx](../ui/src/components/KpiCard.jsx) | KPI component |
| [ui/src/components/ActivityHeatmap.jsx](../ui/src/components/ActivityHeatmap.jsx) | Heatmap |
| [ui/vite.config.js](../ui/vite.config.js) | Proxy `/api` + `/relay` to backend |

---

## Documentation references (read, usually don’t copy verbatim)

| Doc | Sections |
|-----|----------|
| [README.md](../README.md) | How It Works, Relay, Supported Editors, API table |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Architecture, Editor Adapter Details (Cursor, Claude, Codex, VS Code, Zed, OpenCode) |
| [API.md](../API.md) | All `GET /api/*` response shapes |
| [ui/README.md](../ui/README.md) | Frontend dev setup |

---

## Key code anchors (jump table)

### Session stats (`chat_stats`)

```
cache.js:103-120   CREATE TABLE chat_stats
cache.js:241-319   analyzeAndStore(chat)
cache.js:228-231   insertStat prepared statement
```

### Local scan loop

```
cache.js:321-397   scanAll(onProgress, opts)
editors/index.js:28-44   getAllChats()
index.js:290-318   detect editors + count by source
```

### Client → server sync (30s today → 1h MVP / 30s v1)

```
relay-client.js:9        SYNC_INTERVAL_MS = 30000
relay-client.js:115-176  collectProjectData(folders) → { chats, messages, stats }
relay-client.js:181-224  postToRelay() HTTP POST JSON
relay-client.js:277-302  scanAll + sync on interval
```

### Server ingest

```
relay-server.js:242-319  POST /relay/sync (upsert chats, messages, stats)
relay-server.js:123-220  GET /relay/team-stats (aggregates)
relay-server.js:88-100   requireAuth (HMAC token from RELAY_PASSWORD)
```

### Auth patterns

```
relay-server.js:103-110  POST /api/login → token
relay-client.js:242-246  RELAY_PASSWORD → Bearer token
index.js:105-141         --join username (git email)
```

### Aggregations for dashboard (port to your DB)

```
cache.js:464-533    getCachedOverview
cache.js:893-1078   getCachedDashboardStats (hourly, streaks, tokens, models, tools)
cache.js:566-623    getCachedDeepAnalytics
cache.js:1080-1338  estimateCosts / getCostAnalytics
server.js:52-191    wire overview + dashboard-stats to Express
```

---

## External / runtime dependencies

| Dependency | Used in | Notes |
|------------|---------|-------|
| `better-sqlite3` | cache, cursor, vscode, editors | Native module; collector local DB |
| `express` | server, relay-server | Ingest API |
| `chalk`, `log-update` | index, relay-client | CLI UX |
| `@modelcontextprotocol/sdk` | mcp-server | Optional v2 |
| React + Vite | ui/ | Dashboard only |
| `zstd` CLI | zed adapter | System binary |
| Running Windsurf/Antigravity app | windsurf, antigravity | ConnectRPC to LS |

---

## Data paths on disk (macOS) — for adapter development

| Editor | Path (see CONTRIBUTING.md for detail) |
|--------|----------------------------------------|
| Claude Code | `~/.claude/projects/<encoded>/sessions-index.json`, `*.jsonl` |
| Cursor | `~/.cursor/chats/`, `~/Library/Application Support/Cursor/User/` |
| VS Code | `~/Library/Application Support/Code/User/` |
| Codex | `~/.codex/sessions/**/*.jsonl` |
| OpenCode | `~/.local/share/opencode/opencode.db` |
| Local cache (Agentlytics) | `~/.agentlytics/cache.db` |
| Relay DB (team) | `~/.agentlytics/relay.db` |

---

## What NOT to copy into greenfield as-is

| Item | Reason |
|------|--------|
| Full `ui/` SPA | Build team-focused UI; relay pages are closest template |
| `index.js` monolith | Split into `collector` CLI + `server` package |
| GSD tables (`gsd_projects`, `gsd_phases`) | Unrelated unless you want plan tracking |
| Subscription / Keychain usage fetchers in editors | Out of MVP PRD scope |
| `public/` built assets | Regenerate from your UI |

---

## Implementation checklist (greenfield)

- [ ] Copy PRD + this pack to `docs/`
- [ ] Extract `analyzeAndStore` + schema → `packages/collector/lib/analyzer`
- [ ] Fork `editors/claude` + `editors/cursor` → `packages/adapters`
- [ ] Implement `connect` with `sync_interval_sec` (3600 MVP)
- [ ] Implement `POST /v1/sync` from `relay-server` `POST /relay/sync` + PRD `sync_id`/cursor
- [ ] Replace SQLite relay DB with Postgres + `org_id`
- [ ] Add device auth (PRD §8.1) instead of shared `RELAY_PASSWORD`
- [ ] Default `message_content: none` per PRD privacy
- [ ] Port `getCachedOverview` SQL → `GET /v1/team/overview`

---

## Version pin

| Artifact | Version (as of pack creation) |
|----------|-------------------------------|
| agentlytics npm | `0.2.12` (see [package.json](../package.json)) |
| PRD | `1.0` |
| Reference pack | `1.0` |

---

*Generated for greenfield migration from Agentlytics. Update line numbers if upstream changes.*
