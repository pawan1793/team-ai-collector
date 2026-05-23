# Product Requirements Document (PRD)
## Team AI Usage Collector

| Field | Value |
|-------|--------|
| **Document version** | 1.0 |
| **Status** | Draft |
| **Last updated** | 2026-05-23 |
| **Working title** | Team AI Usage Collector (rename TBD) |

---

## 1. Executive summary

Build a **local terminal client** that team members install and run on their machines. The client **reads AI coding agent activity** from local editor/agent storage (sessions, messages, tokens, tools, projects), **normalizes** it, and **uploads** it to a **central server API** on a schedule.

| Phase | Sync interval | Primary outcome |
|-------|----------------|-----------------|
| **MVP** | Every **1 hour** | Prove end-to-end collection, auth, ingestion, and a basic team dashboard |
| **v1 / Final (near-term)** | Every **30 seconds** | Near-real-time team visibility with incremental sync and operational reliability |

The product is **not** a replacement for vendor billing consoles (Cursor, Anthropic, etc.). It is **unified, cross-editor usage telemetry** for engineering leaders and platform teams who want one view of how the team uses AI assistants.

---

## 2. Problem statement

### 2.1 Current pain

- AI usage is **fragmented** across Cursor, Claude Code, Copilot, Windsurf, CLI tools, etc.
- **No single team view** of sessions, tokens, tools, projects, or trends.
- Finance and eng leadership lack **consistent metrics** for cost allocation, adoption, and policy.
- Security/compliance teams cannot easily answer: *who used which agent on which repo, and when?*

### 2.2 Desired outcome

- Each engineer runs one CLI command (or background daemon) after one-time setup.
- Organization receives **structured usage events** on a central server.
- Admins see **team dashboards**: per-user, per-project, per-editor, per-model, over time.

---

## 3. Goals and non-goals

### 3.1 Goals

| ID | Goal |
|----|------|
| G1 | **Collect** normalized AI session metadata and stats from supported local agents |
| G2 | **Upload** to customer-controlled server via HTTPS API |
| G3 | **Identify** team members consistently (`user_id` / email / org membership) |
| G4 | **MVP**: hourly batch sync with idempotent ingestion |
| G5 | **v1**: 30-second incremental sync with low CPU/network overhead |
| G6 | **Privacy controls**: org-configurable redaction (no message bodies, path hashing, opt-in projects) |
| G7 | **Reliable offline behavior**: queue locally, retry with backoff |

### 3.2 Non-goals (MVP)

| ID | Non-goal |
|----|----------|
| NG1 | Real-time streaming to server (WebSockets) — use polling/sync first |
| NG2 | Full Agentlytics-style local dashboard in MVP (server dashboard only) |
| NG3 | Billing integration with OpenAI/Anthropic invoices (future) |
| NG4 | Modifying or intercepting IDE traffic (no proxies, no MITM) |
| NG5 | Windows/Linux in MVP if macOS-only adapters are used first |
| NG6 | Storing end-user credentials for third-party APIs on your server |

---

## 4. Users and personas

| Persona | Needs |
|---------|--------|
| **Engineer (contributor)** | Simple `login` + `connect` flow; minimal perf impact; clear privacy of what is sent |
| **Eng manager** | Adoption, sessions/day, top projects, model mix |
| **Platform / DevEx** | Which editors are used, tool usage, rollout metrics |
| **Security / compliance** | Audit trail, data minimization, retention, export |
| **Org admin** | API keys, member list, policies, disconnect revoked users |

---

## 5. Product overview

### 5.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Engineer machine (macOS first)                                  │
│  ┌──────────────┐    ┌─────────────┐    ┌────────────────────┐ │
│  │ Editor files │───▶│ Local scan  │───▶│ Local SQLite queue │ │
│  │ ~/.cursor …  │    │  adapters   │    │ + cursor state     │ │
│  └──────────────┘    └─────────────┘    └──────────┬─────────┘ │
│                                                     │ sync      │
│  ┌──────────────────────────────────────────────────▼─────────┐ │
│  │ Terminal CLI / background agent (hourly MVP → 30s v1)       │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────────┬─────────────────────────────────┘
                                │ HTTPS POST (JSON)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Your server (customer-hosted or SaaS)                            │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Auth API │  │ Ingest API │  │ Postgres │  │ Admin UI      │  │
│  └──────────┘  └────────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Components

| Component | Owner | Description |
|-----------|--------|-------------|
| **Collector CLI** | Your product | Reads local agent data, analyzes, queues, uploads |
| **Ingestion API** | Your product | Accepts sync payloads, validates, upserts |
| **Control plane** | Your product | Orgs, users, API keys, policies |
| **Analytics store** | Your product | Time-series friendly DB + aggregates |
| **Admin dashboard** | Your product | Team views (MVP: minimal; v1: full) |

Reference pattern (prior art in this repo): Agentlytics **Relay** (`relay-client.js` POST `/relay/sync` every 30s with chats, messages, stats).

---

## 6. Functional requirements

### 6.1 Terminal client — onboarding

| ID | Requirement | MVP | v1 |
|----|-------------|:---:|:---:|
| C1 | `npx <pkg> login` — opens browser or accepts API key + org URL | ✓ | ✓ |
| C2 | Persist credentials in `~/.<app>/config.json` (mode `0600`) | ✓ | ✓ |
| C3 | `npx <pkg> connect` — start sync loop (foreground or `--daemon`) | ✓ | ✓ |
| C4 | Auto-detect identity: `git config user.email` with `--email` override | ✓ | ✓ |
| C5 | First-run consent: show data categories sent + link to policy | ✓ | ✓ |
| C6 | Project scope: default all detected projects; `--projects` allowlist | ✓ | ✓ |
| C7 | `disconnect` / `logout` — revoke local token, stop daemon | ✓ | ✓ |
| C8 | `status` — last sync time, queue depth, errors | ✓ | ✓ |

### 6.2 Terminal client — collection

| ID | Requirement | MVP | v1 |
|----|-------------|:---:|:---:|
| COL1 | Scan local agent storage on each sync cycle | ✓ | ✓ |
| COL2 | Normalize to canonical session + message + stats schema | ✓ | ✓ |
| COL3 | Incremental scan: skip unchanged sessions (`last_updated_at`, `message_count`) | optional | ✓ |
| COL4 | Supported editors MVP: **Claude Code** + **Cursor** (macOS) | ✓ | expand |
| COL5 | Extract: session id, editor, title, project path, timestamps, message counts | ✓ | ✓ |
| COL6 | Extract: tokens (input/output/cache), models, tool names | ✓ | ✓ |
| COL7 | Message **content** upload: org policy `full` \| `redacted` \| `none` | `redacted` default | ✓ |
| COL8 | Hash project paths when `privacy.hash_paths=true` | — | ✓ |
| COL9 | Local SQLite cache for scan results + outbound queue | ✓ | ✓ |

### 6.3 Terminal client — sync

| ID | Requirement | MVP (1h) | v1 (30s) |
|----|-------------|----------|----------|
| SYN1 | Default sync interval: **3600s** (configurable) | ✓ | interval **30s** |
| SYN2 | Payload: incremental **delta** since `last_sync_cursor` | full snapshot OK | ✓ required |
| SYN3 | Idempotency: `sync_id` (UUID) + `batch_sequence` per payload | ✓ | ✓ |
| SYN4 | Retry: exponential backoff (max 24h queue retention) | ✓ | ✓ |
| SYN5 | Compress request body (`gzip`) when &gt; 64KB | — | ✓ |
| SYN6 | Max payload size: 5MB MVP / 10MB v1; chunk large backlogs | ✓ | ✓ |
| SYN7 | Pause sync on battery saver / offline (queue only) | — | ✓ |
| SYN8 | `connect --once` for CI/manual hourly cron | ✓ | ✓ |

### 6.4 Server — ingestion API

| ID | Requirement | MVP | v1 |
|----|-------------|:---:|:---:|
| S1 | `POST /v1/sync` — accept team member upload | ✓ | ✓ |
| S2 | Auth: Bearer device token (issued at login) | ✓ | ✓ |
| S3 | Validate org_id, user_id, schema version | ✓ | ✓ |
| S4 | Upsert sessions by `(org_id, user_id, source, session_id)` | ✓ | ✓ |
| S5 | Upsert session_stats; append messages with dedup key | ✓ | ✓ |
| S6 | Return `accepted`, `rejected`, `next_cursor`, server time | ✓ | ✓ |
| S7 | Rate limits per device (e.g. 120 req/hour MVP, 3600/hour v1) | ✓ | ✓ |
| S8 | Audit log: ingest timestamp, bytes, session count | ✓ | ✓ |

### 6.5 Server — admin & read API

| ID | Requirement | MVP | v1 |
|----|-------------|:---:|:---:|
| A1 | `GET /v1/team/overview` — KPIs for date range | ✓ | ✓ |
| A2 | `GET /v1/team/members` — per-user rollups | ✓ | ✓ |
| A3 | `GET /v1/team/sessions` — paginated list + filters | ✓ | ✓ |
| A4 | `GET /v1/team/sessions/:id` — detail (respect content policy) | ✓ | ✓ |
| A5 | Web dashboard (React) for managers | minimal | full |
| A6 | Export CSV for date range | — | ✓ |

---

## 7. Data model

### 7.1 Canonical entities (client and server)

#### Organization
```json
{
  "org_id": "org_abc123",
  "name": "Acme Engineering",
  "policies": {
    "message_content": "redacted",
    "hash_project_paths": false,
    "retention_days": 90
  }
}
```

#### User (team member)
```json
{
  "user_id": "usr_xyz",
  "org_id": "org_abc123",
  "email": "alice@acme.com",
  "display_name": "Alice",
  "device_id": "dev_unique_per_machine"
}
```

#### Session (`chats`)
```json
{
  "session_id": "composerId-or-session-uuid",
  "source": "claude-code",
  "name": "Fix auth middleware",
  "mode": "agent",
  "project_path": "/Users/alice/acme/api",
  "project_path_hash": null,
  "created_at": 1716000000000,
  "last_updated_at": 1716003600000,
  "message_count": 42,
  "encrypted": false
}
```

#### Session stats (`chat_stats` — aligned with Agentlytics)
```json
{
  "session_id": "…",
  "total_messages": 42,
  "user_messages": 18,
  "assistant_messages": 20,
  "tool_messages": 4,
  "system_messages": 0,
  "tool_calls": ["read_file", "grep", "edit_file"],
  "models": ["claude-sonnet-4-20250514"],
  "total_input_tokens": 120000,
  "total_output_tokens": 8000,
  "total_cache_read": 50000,
  "total_cache_write": 1000,
  "total_user_chars": 45000,
  "total_assistant_chars": 120000,
  "analyzed_at": 1716003600000
}
```

#### Message (optional by policy)
```json
{
  "session_id": "…",
  "seq": 0,
  "role": "user",
  "content": "How do I fix…",
  "model": null,
  "input_tokens": null,
  "output_tokens": null
}
```

**Redacted content policy (recommended default):** truncate to 500 chars, strip paths matching secrets patterns, remove `sk-` / API key-like strings.

### 7.2 Sync payload (POST `/v1/sync`)

```json
{
  "schema_version": "1.0",
  "sync_id": "550e8400-e29b-41d4-a716-446655440000",
  "sent_at": 1716003600000,
  "client": {
    "name": "team-ai-collector",
    "version": "0.1.0",
    "platform": "darwin",
    "node_version": "22.12.0"
  },
  "user": {
    "user_id": "usr_xyz",
    "email": "alice@acme.com",
    "device_id": "dev_abc"
  },
  "cursor": {
    "since": 1715990000000,
    "last_session_watermark": 1716003500000
  },
  "summary": {
    "sessions_scanned": 120,
    "sessions_changed": 3,
    "messages_uploaded": 45,
    "bytes_estimate": 280000
  },
  "sessions": [],
  "session_stats": [],
  "messages": [],
  "heartbeat": {
    "editors_detected": ["claude-code", "cursor"],
    "collector_uptime_sec": 3600
  }
}
```

### 7.3 Server database (recommended)

| Table | Purpose |
|-------|---------|
| `organizations` | Tenant |
| `users` | Members |
| `devices` | Per-machine tokens |
| `sessions` | Upserted session headers |
| `session_stats` | Latest stats per session |
| `messages` | Optional; partitioned by month |
| `sync_events` | Ingest audit (`sync_id`, counts, status) |
| `daily_aggregates` | Precomputed rollups for dashboard speed |

**Unique keys:**
- `sessions`: `(org_id, user_id, source, session_id)`
- `messages`: `(org_id, user_id, session_id, seq)`

---

## 8. API specification (MVP)

Base URL: `https://api.yourproduct.com` (or self-hosted)

### 8.1 Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/auth/device` | POST | Exchange one-time code or API key for `device_token` |
| `/v1/auth/refresh` | POST | Refresh token (v1) |

**Headers for sync:**
```
Authorization: Bearer <device_token>
Content-Type: application/json
X-Org-Id: org_abc123
X-Schema-Version: 1.0
```

### 8.2 Core endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/sync` | POST | Ingest payload (§7.2) |
| `/v1/health` | GET | Liveness |
| `/v1/team/overview` | GET | Admin/manager aggregates |
| `/v1/team/members` | GET | Per-member stats |
| `/v1/team/sessions` | GET | List/filter sessions |

### 8.3 Response — sync success

```json
{
  "ok": true,
  "sync_id": "550e8400-e29b-41d4-a716-446655440000",
  "accepted": {
    "sessions": 3,
    "session_stats": 3,
    "messages": 45
  },
  "rejected": [],
  "next_cursor": {
    "since": 1716003600000
  },
  "server_time": 1716003600123,
  "next_sync_after_sec": 3600
}
```

### 8.4 Error codes

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `INVALID_SCHEMA` | Payload validation failed |
| 401 | `UNAUTHORIZED` | Bad or expired token |
| 403 | `POLICY_VIOLATION` | Content not allowed for org |
| 413 | `PAYLOAD_TOO_LARGE` | Chunk required |
| 429 | `RATE_LIMITED` | Back off |
| 503 | `SERVER_BUSY` | Retry later |

---

## 9. Sync strategy — MVP (1 hour) vs v1 (30 seconds)

### 9.1 MVP: hourly batch

| Aspect | Design |
|--------|--------|
| **Trigger** | `setInterval(3600_000)` or system cron `0 * * * *` + `connect --once` |
| **Scan** | Full scan of adapters each hour (acceptable for MVP scale) |
| **Upload** | Send all sessions with `last_updated_at > cursor.since` OR full stats snapshot first N days |
| **Dedup** | Server upserts by natural keys; client stores `last_successful_sync_at` |
| **Failure** | Queue entire payload in `outbound_queue` table; retry next hour or on manual `sync --force` |
| **User experience** | “Last synced 42 minutes ago” in `status` |

**Rationale:** Lower server load, simpler client, easier debugging, acceptable for leadership dashboards that are not real-time.

### 9.2 v1: 30-second incremental

| Aspect | Design |
|--------|--------|
| **Trigger** | Daemon default `interval_sec=30` (configurable) |
| **Scan** | Lightweight: list sessions from indexes only; deep-read only **changed** sessions |
| **Change detection** | `(last_updated_at, message_count)` vs local cache |
| **Upload** | Delta only: new/changed sessions, new messages since `last_message_seq` |
| **Backoff** | If 429/503, exponential backoff up to 15 min without dropping data |
| **Compression** | gzip bodies &gt; 64KB |
| **Chunking** | Split at 500 sessions or 5MB per request |

**Rationale:** Matches near-real-time ops use cases (who is active now, spike detection). Agentlytics relay already uses 30s (`SYNC_INTERVAL_MS = 30000`).

### 9.3 Sync state machine (client)

```
IDLE → SCANNING → BUILDING_PAYLOAD → UPLOADING → ACKED → IDLE
                      ↓ failure          ↓ failure
                   QUEUED ←──────────────┘
```

---

## 10. Security, privacy, and compliance

### 10.1 Principles

| Principle | Implementation |
|-----------|----------------|
| **Least privilege** | Device token scoped to `ingest:write` only |
| **Customer data ownership** | Self-host option; clear DPA |
| **Transparency** | First-run disclosure + `status --verbose` |
| **Minimization** | Default: stats + metadata; messages redacted or omitted |
| **Encryption in transit** | TLS 1.2+ only |
| **No secrets in payloads** | Client-side scrubber for API keys, tokens, `.env` patterns |

### 10.2 Threat model (abbreviated)

| Threat | Mitigation |
|--------|------------|
| Stolen device token | Short TTL, refresh, revoke in admin UI |
| MITM | TLS + cert pinning (enterprise option) |
| Malicious payload | Schema validation, size limits, WAF |
| PII leakage in prompts | Redaction + org policy `message_content: none` |
| Insider reading chats | RBAC on dashboard; audit logs |

### 10.3 Compliance checklist (v1)

- [ ] Data retention configurable per org
- [ ] Right to delete user data (`DELETE /v1/users/:id/data`)
- [ ] SOC2-ready logging (no message bodies in logs)

---

## 11. Non-functional requirements

| Category | MVP | v1 |
|----------|-----|-----|
| **Client CPU** | &lt; 30s scan spike per hour | &lt; 5% sustained during 30s loop |
| **Client memory** | &lt; 256MB | &lt; 256MB |
| **Client disk** | &lt; 500MB local cache | configurable cap |
| **Network** | &lt; 5MB/hour typical | &lt; 50MB/hour active dev |
| **Server ingest latency** | p95 &lt; 2s | p95 &lt; 500ms |
| **Availability** | 99% | 99.9% |
| **Supported OS** | macOS 13+ | + Linux, Windows |

---

## 12. MVP scope definition

### 12.1 In scope (MVP — target 4–6 weeks)

1. **Collector CLI** (Node.js): login, connect, hourly sync, status
2. **Adapters**: Claude Code + Cursor (macOS)
3. **Local cache**: SQLite (`sessions`, `session_stats`, `messages`, `outbound_queue`, `sync_meta`)
4. **Server**: `POST /v1/sync`, `POST /v1/auth/device`, Postgres storage
5. **Dashboard**: single page — total sessions, messages, tokens, active members (7d)
6. **Auth**: org API key + per-device token
7. **Privacy**: `message_content: none` default for MVP

### 12.2 Out of scope (MVP)

- 30-second sync (v1)
- Full message search
- More than 2 editors
- SSO / SAML
- Cost estimation from `pricing.json`
- Mobile app

### 12.3 MVP success criteria

| Metric | Target |
|--------|--------|
| Setup time per engineer | &lt; 5 minutes |
| Successful sync rate | &gt; 95% over 7 days |
| Data freshness | &lt; 65 minutes lag |
| Pilot team size | 5–20 users |
| Zero P0 security incidents in pilot |

---

## 13. Roadmap phases

### Phase 0 — Design (1 week)
- Finalize schema v1.0
- API OpenAPI spec
- Privacy defaults sign-off

### Phase 1 — MVP (4–6 weeks)
- Client: scan + hourly upload
- Server: ingest + minimal dashboard
- Pilot with one team

### Phase 2 — v1 near-real-time (3–4 weeks)
- 30s incremental sync
- Delta payloads + gzip
- 3+ editors (VS Code, Codex, OpenCode)
- Manager dashboard v1

### Phase 3 — Enterprise (ongoing)
- SSO, self-host Helm chart
- Path hashing, custom retention
- Cost estimates, exports, webhooks
- Linux/Windows adapters

---

## 14. User flows

### 14.1 Engineer — first connect

```
1. Admin creates org → shares invite link / API key
2. Engineer: npx team-ai-collector login --org https://api.acme.com --key org_xxx
3. CLI stores device_token in ~/.team-ai/config.json
4. Engineer: npx team-ai-collector connect
5. CLI shows: "Syncing every 60 minutes. Detected: Claude Code (12 sessions), Cursor (48 sessions)."
6. Background loop runs (or cron for --once mode)
```

### 14.2 Manager — view usage

```
1. Manager opens https://app.acme.com
2. Selects date range: Last 7 days
3. Sees: active members, total sessions, token estimate, top projects
4. Drills into member → session list → session detail (if policy allows)
```

---

## 15. CLI command reference (proposed)

| Command | Description |
|---------|-------------|
| `login` | Authenticate and save device token |
| `logout` | Remove local credentials |
| `connect` | Start sync loop (default interval from config) |
| `connect --once` | Single sync (for cron) |
| `connect --interval 3600` | Override interval (seconds) |
| `connect --daemon` | Fork background process |
| `status` | Last sync, queue, editors detected |
| `scan` | Local scan only, no upload (debug) |
| `config set privacy.message_content none` | Policy override if org allows |

**Default config (`~/.team-ai/config.json`):**
```json
{
  "api_base": "https://api.yourproduct.com",
  "org_id": "org_abc",
  "device_token": "…",
  "user_email": "alice@acme.com",
  "sync_interval_sec": 3600,
  "privacy": { "message_content": "none" },
  "projects": null
}
```

---

## 16. Metrics and analytics (product)

| Metric | Description |
|--------|-------------|
| DAU (collectors) | Devices that synced in 24h |
| Sync success rate | ACKed / attempted |
| Lag | `now - last_updated_at` of latest ingested session |
| Sessions per user per day | Adoption |
| Token volume by model/editor | Cost drivers |
| Time to first sync | Onboarding funnel |

---

## 17. Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Editor storage format changes | Broken adapters | Version adapters; integration tests on sample files |
| Engineers reject “surveillance” | Low adoption | Opt-in projects, no content default, internal comms |
| Large message payloads | Cost + latency | Stats-only default; chunking |
| Hourly sync too stale for ops | Wrong product fit | Clear MVP positioning; v1 30s |
| Legal (EU works councils) | Block rollout | DPA, minimization, self-host |
| Duplicate users (multiple machines) | Inflated counts | `device_id` + dedupe rules in dashboard |

---

## 18. Open questions

| # | Question | Owner | Decision needed by |
|---|----------|-------|-------------------|
| O1 | SaaS only vs self-hosted MVP? | Founder | Phase 0 |
| O2 | Upload full messages ever, or stats-only forever? | Legal + PM | Phase 0 |
| O3 | User identity: email from git vs SSO subject? | Eng | Phase 1 |
| O4 | One org per customer or multi-org? | PM | Phase 1 |
| O5 | Reuse Agentlytics adapters vs fork? | Eng | Phase 1 |
| O6 | Estimated cost model in v1? | PM | Phase 2 |

---

## 19. Appendix A — Mapping from Agentlytics

| Agentlytics | This product |
|-------------|--------------|
| `cache.js` → `chat_stats` | Same stats fields in sync payload |
| `editors/*.js` | Reuse or extract as `@yourpkg/adapters` |
| `relay-client.js` 30s sync | v1 target; MVP is 1h |
| `relay-server.js` `/relay/sync` | Inspiration for `POST /v1/sync` |
| Local dashboard | Replaced by **server** team dashboard |

---

## 20. Appendix B — Suggested tech stack

| Layer | Recommendation |
|-------|----------------|
| Collector | Node.js ≥ 20.19, `better-sqlite3`, `commander` |
| Server | Node (Express/Fastify) or Go; Postgres 15+ |
| Queue (v1 scale) | Redis or SQS for async ingest |
| Dashboard | React + Vite |
| Auth | API keys MVP → WorkOS/Auth0 SSO v1 |
| Hosting | Fly.io / Railway MVP → AWS ECS enterprise |

---

## 21. Document approval

| Role | Name | Date | Sign-off |
|------|------|------|----------|
| Product | | | |
| Engineering | | | |
| Security | | | |

---

*End of PRD*
