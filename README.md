# Cloud Pulse Dashboard

Build a dark-themed cloud monitoring dashboard web app called "CloudPulse". No auth, no backend, frontend only.

Layout: Fixed left sidebar (240px wide) with the logo/name "CloudPulse" at top, then nav items with lucide-react icons: Overview, Infrastructure, Alerts, Settings (only Overview needs real content; others can be simple placeholder pages). Top bar with the current page title on the left and a time-range selector dropdown on the right with options: Last 1 hour, Last 6 hours, Last 24 hours, Last 7 days (default: Last 6 hours).

Overview page: A responsive grid of panels (2 columns on desktop, 1 on mobile). Each panel is a card with a header showing its title, and a body containing an iframe filling the card (height ~340px). While an iframe loads, show an animated shimmer skeleton over it.

Panel config: Define all panels in ONE config file, an array where each entry has { title, baseUrl }. Include 4 placeholder entries: "CPU Utilization", "Network In/Out", "Memory Usage", "Request Count", each with baseUrl "http://localhost:3000/d-solo/REPLACE_ME?orgId=1&panelId=1". Build each iframe src by taking baseUrl and appending time-range params.

Time-range wiring: Keep the selected range in state. Map it to Grafana URL params: 1h → &from=now-1h&to=now, 6h → &from=now-6h&to=now, 24h → &from=now-24h&to=now, 7d → &from=now-7d&to=now. Every iframe src = baseUrl + range params + "&theme=dark&kiosk&refresh=60s". When the dropdown changes, all iframes update.

Style: Page background #181b1f, card background #22252b, borders #2c3235, text #e0e2e7, muted text #8e939c, one accent color #4f8ff7 used sparingly (active nav item, dropdown highlight). Inter font. Minimal, modern, premium feel like Linear or Vercel — subtle 1px borders, 8px card radius, generous spacing, no gradients, no clutter.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/efead255-0c71-41c0-b1dd-44ea2932b2a2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Running locally

Everything runs on your machine via Docker Compose — 13 containers plus the
Vite dev server. Nothing points at a remote host.

### Prerequisites

| | Tested with |
| --- | --- |
| Docker Desktop (running) | 29.4.3 |
| Docker Compose | 5.1.3 |
| Node.js | 24.x (20+ works) |

Docker needs roughly **4 GB of RAM** available — Zabbix, Postgres, Grafana and
the three stores add up.

### Start it

```sh
git clone https://github.com/IntertecAitools/CloudPulse.git
cd CloudPulse/cloud-pulse-dashboard

npm install            # ~1 min, first time only
docker compose up -d   # ~25s warm, several minutes on a cold pull
npm run dev            # Vite on :8080, ~30s to first serve
```

Open <http://localhost:8080>.

The **first `docker compose up` is much slower** than later ones: it pulls
~10 images and Grafana downloads the Zabbix plugin. Give it a few minutes and
watch `docker compose ps` until everything reads `Up`.

### First login

1. Go to **/register** and create an account. Registration is open, so the
   first user just signs up.
2. **Settings → Cloud Accounts** — connect AWS (an IAM user with
   `CloudWatchReadOnlyAccess`) or Azure (an Entra app with *Monitoring Reader*).

Cloud pages stay empty until an account is connected — CloudPulse queries your
real cloud APIs and never fabricates data.

### What works immediately, with no setup

- **Logs** — Alloy ships every container's output into Loki from the moment
  the stack starts
- **Traces** — CloudPulse instruments its own services, so Tempo has data
- **Servers** — the bundled Zabbix agent monitors the host

### Checking it came up

```sh
docker compose ps                  # all 13 should read Up
node scripts/verify-zabbix.mjs     # end-to-end Zabbix check
```

Grafana registers its datasource plugins a few seconds after the container
reports `Up`. A health check run immediately can return
`Plugin not registered` for Tempo — wait ~10s and retry before assuming
something is broken.

### How it fits together

Vite serves the app on `:8080` and proxies the four API prefixes into nginx on
`:8081`, which enforces Basic auth and fans out exactly as production does:

| Path | Goes to |
| --- | --- |
| `/auth/*` | auth service (`:8082`) — open, no Basic auth |
| `/alerts-api/*`, `/dashboards-api/*` | monitoring service (`:8083`) |
| `/grafana/*` | Grafana (`:3000`), with the browser's credential swapped for Grafana's |

Behind Grafana sits the data plane. The app never talks to any of these
directly — everything goes through Grafana's `/api/ds/query`, so adding a
signal type means adding a datasource, not a new query layer in the frontend.

| Service | Role |
| --- | --- |
| Prometheus (`:9090`) | Metrics for non-AWS targets; also drives uptime checks |
| Blackbox exporter | HTTP/TCP/ICMP probes that Prometheus scrapes |
| Loki | Log aggregation |
| Tempo (`:4317` gRPC, `:4318` HTTP) | OTLP trace ingest |
| CloudWatch | Added at runtime per AWS account, via Settings |

Prometheus, Loki and Tempo are provisioned into Grafana at startup from
`deploy/grafana/provisioning/`. They don't pollute the app's AWS account picker,
which filters datasources to `type === "cloudwatch"`.

**Uptime checks** are files, not config: Prometheus reloads
`deploy/prometheus/targets/uptime-*.yml` every 30s, so checks can be added and
removed at runtime without restarting anything. `deploy/prometheus/targets/`
holds a seed check against the dev server.

State (htpasswd, `alerts.json`, `dashboards.json`) lives in the
`cloudpulse-state` volume. Grafana, Prometheus, Loki and Tempo each have their
own volume.

Image tags are pinned deliberately. Tempo is held at 2.x because 3.0
restructured its config schema (no top-level `ingester`/`compactor` blocks).

### Configuration

Defaults are baked in so `docker compose up` needs no `.env`. To override, put
any of these in a `.env` next to `docker-compose.yml`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CLOUDPULSE_PORT` | `8081` | Host port for nginx |
| `PROMETHEUS_PORT` | `9090` | Host port for Prometheus |
| `OTLP_GRPC_PORT` / `OTLP_HTTP_PORT` | `4317` / `4318` | Tempo trace ingest |
| `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` | `admin` / `admin` | Grafana admin, also the credential nginx injects |
| `GRAFANA_TOKEN` | _unset_ | Service-account token; takes precedence over admin basic auth when set |
| `INVITE_CODE` | _unset_ | Reserved — **not currently enforced by the auth service** |
| `GMAIL_USER` / `GMAIL_PASS` | _unset_ | Reserved — **email alerts are not wired up yet** |

To point the frontend at a remote deployment instead of the local stack:

```sh
CLOUDPULSE_API_TARGET=http://your-host npm run dev
```

Handy commands:

```sh
docker compose logs -f monitoring   # alert evaluation loop
docker compose down                 # stop (keeps volumes)
docker compose down -v              # stop and wipe all local state
```
