# CloudPulse Architecture

Custom-UI cloud monitoring; Grafana runs headless as the data engine.

Browser -> nginx :80 (auth perimeter)
  /                  -> frontend (TanStack Start SSR) :8080
  /auth/*            -> services/auth/server.mjs      :8082
  /alerts-api/*      -> services/monitoring/server.mjs :8083  (basic auth)
  /dashboards-api/*  -> services/monitoring/server.mjs :8083  (basic auth)
  /grafana/*         -> Grafana (Docker) :3000  (basic auth + token injected)

Locally the same topology runs under docker-compose.yml, with Vite on :8080
proxying the API prefixes into nginx on :8081. See README "Running locally".
Service paths/ports/Grafana URL are env-driven (CLOUDPULSE_STATE_DIR, HOST,
PORT, GRAFANA_URL) so the same code runs in containers or on a host.

State on server: /etc/cloudpulse/ (htpasswd, alerts.json, dashboards.json).
Secrets: /etc/cloudpulse-style env in systemd units (see deploy/*.service,
values stripped; deploy/cloudpulse.env.example documents them).
Frontend layering: src/routes = pages, src/components = UI,
src/hooks = data fetching, src/lib = API clients (grafana-api, auth).
Full details: CloudPulse_Project_Documentation.pdf (team doc).
