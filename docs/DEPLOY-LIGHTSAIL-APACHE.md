# Deploying on AWS Lightsail (Ubuntu + Apache, no Docker, RDS Postgres)

This guide deploys **Team AI Collector** on a single **AWS Lightsail Ubuntu** instance using:

- **Node.js + systemd** to run the API server (no Docker)
- **Apache (`apache2`)** to serve the dashboard and reverse-proxy the API
- **Amazon RDS for PostgreSQL** as the managed database (not on the instance)

For Docker-based or local-dev setups, see [RUNNING.md](./RUNNING.md).

---

## Architecture

```
                          Lightsail (Ubuntu)
 Browser ──HTTPS──▶ Apache :80/:443 ─┬─ static ─▶ packages/dashboard/dist
                                     │
 Collector CLI ─────────────────────┴─ /v1/* ──▶ Node API (systemd) 127.0.0.1:8080
                                                        │
                                                        ▼  TLS
                                              Amazon RDS PostgreSQL :5432
```

- The Node API binds to **localhost only**; Apache is the sole public entry point.
- The dashboard is a **static Vite build**; no Node process runs it at runtime.
- The dashboard calls the API **same-origin** (`/v1/...`), which Apache proxies to the API. This works because the dashboard uses `VITE_API_BASE || ''` ([packages/dashboard/src/api.js](../packages/dashboard/src/api.js)).

| Component | Where it runs | Port |
|-----------|---------------|------|
| Apache | Lightsail instance | 80 / 443 (public) |
| Node API server | Lightsail instance (systemd) | 8080 (localhost only) |
| PostgreSQL | Amazon RDS | 5432 (private) |

---

## Prerequisites

- An AWS account with permission to create Lightsail instances and RDS databases.
- A domain name you can point at the instance (for HTTPS).
- The repository URL for this project.

---

## 1. Provision the RDS PostgreSQL database

1. **RDS → Create database**
   - Engine: **PostgreSQL** (15 or newer)
   - Template: **Production** (or Dev/Test for a pilot)
   - DB instance class: `db.t3.micro` is fine for a pilot
   - Storage: 20 GB gp3, enable autoscaling
   - **Credentials:** master username `teamai_admin`, set a strong password
   - **Public access:** see networking note below
   - Initial database name: `teamai`
2. Note the **endpoint** (e.g. `teamai-db.abc123.us-east-1.rds.amazonaws.com`) and **port** (`5432`).

### Networking: let Lightsail reach RDS

Lightsail and RDS live in different networks by default. Pick one:

**Option A — Lightsail VPC peering (recommended, private):**
1. Lightsail console → **Account → Advanced → VPC peering** → enable peering with the AWS default VPC in the same Region.
2. Set RDS **Public access = No**.
3. In the RDS instance's **security group**, add an inbound rule: type **PostgreSQL (5432)**, source = the **default VPC CIDR** (e.g. `172.26.0.0/16`). Traffic stays internal.

**Option B — Public RDS, IP-restricted (simpler):**
1. Set RDS **Public access = Yes**.
2. Allocate a **static IP** for the Lightsail instance (step 2 below) first.
3. In the RDS security group, add inbound **PostgreSQL (5432)** with source = the Lightsail instance's **static public IP /32**.

> RDS enforces TLS in transit by default — this guide connects with `sslmode=no-verify` so no certificate files are needed. See [Stricter TLS](#stricter-tls-optional) to verify the RDS CA.

---

## 2. Provision the Lightsail instance

1. **Lightsail → Create instance**
   - Platform: **Linux/Unix**, Blueprint: **OS Only → Ubuntu 24.04 LTS**
   - Plan: **2 GB RAM / 2 vCPU** minimum
2. Attach a **static IP** (Networking tab) so the address survives reboots.
3. **Networking → IPv4 Firewall** — allow:

   | Application | Protocol | Port |
   |-------------|----------|------|
   | SSH | TCP | 22 |
   | HTTP | TCP | 80 |
   | HTTPS | TCP | 443 |

   Do **not** open 8080 or 5432 publicly.

---

## 3. Install Node.js, Apache, and tools

SSH into the instance, then:

```bash
# Node.js 20 (repo requires Node >= 20.19)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git apache2 postgresql-client

# Apache reverse-proxy + SPA modules
sudo a2enmod proxy proxy_http rewrite headers
sudo systemctl restart apache2
```

`postgresql-client` is only for a connectivity test; the database itself is on RDS.

---

## 4. Clone the repo and install dependencies

```bash
sudo mkdir -p /opt/team-ai-collector && sudo chown $USER /opt/team-ai-collector
git clone https://github.com/pawan1793/team-ai-collector.git /opt/team-ai-collector
cd /opt/team-ai-collector
npm install
```

---

## 5. Configure the server (point at RDS)

The server loads `packages/server/.env` via dotenv ([packages/server/src/env.js](../packages/server/src/env.js)). Create it with the RDS endpoint:

```bash
cat > packages/server/.env <<'EOF'
DATABASE_URL=postgresql+asyncpg://postgres:g%2AVW%2B0%60ml4FrpwTO6%23%3CP%2BgEH3KRiW~qj@postgres-stag-proxt.proxy-c3vu3bffbipw.us-east-1.rds.amazonaws.com/team-ai
PORT=8080
ADMIN_API_KEY=THALIA_TECH_2026_PM
DEVICE_TOKEN_SECRET=THALIA_TECH_2026_PM
DEFAULT_MESSAGE_CONTENT=full
EOF
chmod 600 packages/server/.env
```

- Replace `DB_PASSWORD`, `YOUR_RDS_ENDPOINT`, and the two secrets.
- Generate strong secrets: `openssl rand -hex 32` (run once for each).
- `?sslmode=no-verify` enables TLS to RDS without a CA bundle. URL-encode any special characters in the password.

**Test connectivity to RDS** before starting the service:

```bash
psql "postgresql://teamai_admin:DB_PASSWORD@YOUR_RDS_ENDPOINT:5432/teamai?sslmode=require" -c '\conninfo'
```

If this hangs or is refused, revisit the RDS security group / VPC peering in step 1.

---

## 6. Run the API server with systemd

```bash
sudo tee /etc/systemd/system/team-ai-server.service > /dev/null <<EOF
[Unit]
Description=Team AI Collector API server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/team-ai-collector
ExecStart=/usr/bin/node packages/server/src/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now team-ai-server
sudo systemctl status team-ai-server --no-pager   # expect "listening on :8080"
curl -s http://127.0.0.1:8080/v1/health           # {"ok":true,...}
```

On first start the server runs `migrations/001_initial.sql` against RDS automatically ([packages/server/src/db.js](../packages/server/src/db.js)).

---

## 7. Build the dashboard (static)

Build with an **empty** `VITE_API_BASE` so the browser calls `/v1` on the same host Apache serves:

```bash
cd /opt/team-ai-collector
VITE_API_BASE="" npm run build -w @team-ai/dashboard
# Output: packages/dashboard/dist/
```

---

## 8. Configure the Apache virtual host

Create `/etc/apache2/sites-available/team-ai.conf`:

```apache
<VirtualHost *:80>
    ServerName dashboard.yourdomain.com

    DocumentRoot /opt/team-ai-collector/packages/dashboard/dist

    <Directory /opt/team-ai-collector/packages/dashboard/dist>
        Require all granted
        # SPA fallback: serve index.html for client-side routes
        FallbackResource /index.html
    </Directory>

    # Reverse-proxy the API. /v1 is matched before the filesystem.
    ProxyPreserveHost On
    ProxyPass        /v1/  http://127.0.0.1:8080/v1/
    ProxyPassReverse /v1/  http://127.0.0.1:8080/v1/

    ErrorLog  ${APACHE_LOG_DIR}/team-ai-error.log
    CustomLog ${APACHE_LOG_DIR}/team-ai-access.log combined
</VirtualHost>
```

Give Apache (`www-data`) traverse access to the build directory:

```bash
sudo chmod o+x /opt /opt/team-ai-collector /opt/team-ai-collector/packages /opt/team-ai-collector/packages/dashboard
```

Enable the site:

```bash
sudo a2ensite team-ai.conf
sudo a2dissite 000-default.conf          # free port 80 from the default page
sudo apache2ctl configtest && sudo systemctl reload apache2
```

---

## 9. DNS + HTTPS

1. Add an **A record** for `dashboard.yourdomain.com` → the Lightsail **static IP**.
2. Issue a certificate:

```bash
sudo apt-get install -y certbot python3-certbot-apache
sudo certbot --apache -d dashboard.yourdomain.com
```

Certbot rewrites the vhost for port 443 and configures auto-renewal.

---

## 10. Bootstrap an organization

```bash
cd /opt/team-ai-collector
node packages/server/scripts/bootstrap-org.js --name "Your Team Name"
```

Copy the printed **`org_api_key`** — it is shown **once**. Use it to:

- Log into the dashboard at `https://dashboard.yourdomain.com`
- Onboard engineers (their collector `login --key org_...`, pointing `--org` at `https://dashboard.yourdomain.com`)

---

## Verify end-to-end

```bash
curl -s  https://dashboard.yourdomain.com/v1/health   # {"ok":true,...} via Apache → API
curl -sI https://dashboard.yourdomain.com/            # 200, dashboard HTML
```

Then open the domain in a browser, paste the org API key, and click **Load**.

---

## Operations

```bash
# API server
sudo systemctl restart team-ai-server
sudo journalctl -u team-ai-server -f

# Deploy an update
cd /opt/team-ai-collector && git pull && npm install
VITE_API_BASE="" npm run build -w @team-ai/dashboard
sudo systemctl restart team-ai-server && sudo systemctl reload apache2
```

**Backups:** managed by RDS — enable automated snapshots and set a retention window in the RDS console. For an on-demand dump:

```bash
pg_dump "postgresql://teamai_admin:DB_PASSWORD@YOUR_RDS_ENDPOINT:5432/teamai?sslmode=require" > teamai-$(date +%F).sql
```

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---------|--------------------|
| `team-ai-server` fails, logs show connection timeout | RDS security group / VPC peering not allowing the instance. Re-check step 1. |
| `no pg_hba.conf entry` or `SSL off` errors | Keep `?sslmode=no-verify` (or `require`) in `DATABASE_URL`; RDS requires TLS. |
| Apache 403 on the dashboard | `www-data` lacks traverse permission — re-run the `chmod o+x` chain in step 8. |
| `/v1/...` returns 404 from Apache | `proxy`/`proxy_http` mods not enabled, or ProxyPass missing. `sudo a2enmod proxy proxy_http && sudo systemctl reload apache2`. |
| Dashboard loads but API calls fail | Confirm it was built with `VITE_API_BASE=""` so calls are same-origin. |
| Refreshing a dashboard route 404s | Ensure `FallbackResource /index.html` is in the `<Directory>` block. |

### Stricter TLS (optional)

`sslmode=no-verify` encrypts traffic but does not verify the RDS server certificate. To verify the CA:

1. Download the RDS CA bundle:
   ```bash
   sudo curl -o /opt/rds-ca.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
   ```
2. Change the connection string to `?sslmode=verify-full` and tell `pg` where the CA lives by adding to the systemd `[Service]` block:
   ```ini
   Environment=PGSSLROOTCERT=/opt/rds-ca.pem
   ```
3. `sudo systemctl daemon-reload && sudo systemctl restart team-ai-server`.

---

## Environment variables (server)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | RDS Postgres connection string (include `?sslmode=no-verify`) |
| `PORT` | No | `8080` | API listen port (keep on localhost) |
| `ADMIN_API_KEY` | Yes (prod) | `change-me-admin-key` | Protects `POST /v1/admin/orgs` |
| `DEVICE_TOKEN_SECRET` | Yes (prod) | `change-me-device-secret` | HMAC secret for device tokens |
| `DEFAULT_MESSAGE_CONTENT` | No | `none` | New-org policy: `none`, `redacted`, `full` |
