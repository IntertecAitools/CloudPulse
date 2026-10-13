#!/usr/bin/env node
/**
 * End-to-end check of the Zabbix integration.
 *
 *   node scripts/verify-zabbix.mjs
 *
 * Walks the whole chain — database, server, API, Grafana plugin, datasource,
 * and a real query — and reports where it breaks rather than just "it doesn't
 * work". Every step is independent, so a failure part-way still tells you
 * what's downstream.
 *
 * Env overrides: CLOUDPULSE_URL, CLOUDPULSE_USER, CLOUDPULSE_PASSWORD,
 *                ZABBIX_WEB_URL, ZABBIX_API_USER, ZABBIX_API_PASSWORD
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CP = process.env.CLOUDPULSE_URL ?? "http://localhost:8081";
const CP_USER = process.env.CLOUDPULSE_USER ?? "localdev";
const CP_PASS = process.env.CLOUDPULSE_PASSWORD ?? "localdev123";
const ZBX_WEB = process.env.ZABBIX_WEB_URL ?? "http://localhost:8090";
const ZBX_USER = process.env.ZABBIX_API_USER ?? "Admin";
const ZBX_PASS = process.env.ZABBIX_API_PASSWORD ?? "zabbix";

const auth = "Basic " + Buffer.from(`${CP_USER}:${CP_PASS}`).toString("base64");

let failed = 0;
const pass = (m, d = "") => console.log(`  PASS  ${m}${d ? `  — ${d}` : ""}`);
const fail = (m, d = "") => { failed++; console.log(`  FAIL  ${m}${d ? `  — ${d}` : ""}`); };
const step = (n) => console.log(`\n${n}`);

const compose = (args) =>
  run("docker", ["compose", ...args], { cwd: projectRoot })
    .then((r) => r.stdout.trim())
    .catch((e) => { throw new Error((e.stderr || e.message).split("\n")[0]); });

async function main() {
  console.log("Zabbix integration check\n" + "=".repeat(40));

  // 1 ── containers -------------------------------------------------------
  step("1. Containers");
  try {
    const out = await compose(["ps", "--format", "{{.Service}} {{.Status}}"]);
    for (const svc of ["zabbix-server", "zabbix-web", "zabbix-agent", "postgres", "grafana"]) {
      const line = out.split("\n").find((l) => l.startsWith(svc + " "));
      if (line && /Up/.test(line)) pass(svc, line.slice(svc.length).trim());
      else fail(svc, line ? line.slice(svc.length).trim() : "not running");
    }
  } catch (e) {
    fail("docker compose ps", e.message);
    console.log("\nDocker isn't reachable — nothing else can be checked.");
    process.exit(1);
  }

  // 2 ── zabbix has its own database ---------------------------------------
  step("2. Database");
  try {
    const dbs = await compose(["exec", "-T", "postgres", "psql", "-U", "cloudpulse", "-d", "cloudpulse",
      "-tAc", "SELECT datname FROM pg_database WHERE datistemplate = false;"]);
    dbs.includes("zabbix")
      ? pass("zabbix database exists")
      : fail("zabbix database missing",
             "the init script only runs on a fresh volume: docker compose down && docker volume rm cloudpulse_postgres-data");
    const tables = await compose(["exec", "-T", "postgres", "psql", "-U", "zabbix", "-d", "zabbix",
      "-tAc", "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"]);
    Number(tables) > 50
      ? pass("schema loaded", `${tables.trim()} tables`)
      : fail("schema not loaded", `${tables.trim()} tables — zabbix-server populates this on first boot, give it a minute`);
  } catch (e) {
    fail("database query", e.message);
  }

  // 3 ── the API answers ---------------------------------------------------
  step("3. Zabbix API");
  let token = null;
  const rpc = async (method, params, withAuth = true) => {
    const body = { jsonrpc: "2.0", method, params, id: 1 };
    if (withAuth && token) body.auth = token;
    const r = await fetch(`${ZBX_WEB}/api_jsonrpc.php`, {
      method: "POST",
      headers: { "Content-Type": "application/json-rpc" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.error) throw new Error(`${j.error.message} ${j.error.data ?? ""}`);
    return j.result;
  };

  try {
    const v = await rpc("apiinfo.version", {}, false);
    pass("API reachable", `Zabbix ${v}`);
  } catch (e) {
    fail("API unreachable", `${e.message} — is zabbix-web up on ${ZBX_WEB}?`);
  }

  try {
    token = await rpc("user.login", { username: ZBX_USER, password: ZBX_PASS }, false);
    pass("API login", `as ${ZBX_USER}`);
    if (ZBX_PASS === "zabbix") {
      console.log("        note: still the shipped default password — change it (see deploy/zabbix/README.md)");
    }
  } catch (e) {
    fail("API login", e.message);
  }

  // 4 ── hosts and data ----------------------------------------------------
  step("4. Monitored hosts");
  if (token) {
    try {
      const hosts = await rpc("host.get", { output: ["host", "status"] });
      hosts.length
        ? pass(`${hosts.length} host(s)`, hosts.map((h) => h.host).join(", "))
        : fail("no hosts", "add one in the Zabbix UI — deploy/zabbix/README.md");

      for (const h of hosts) {
        const items = await rpc("item.get", { hostids: h.hostid, output: ["name", "lastvalue", "lastclock"], limit: 500 });
        const fresh = items.filter((i) => Number(i.lastclock) > Date.now() / 1000 - 600);
        fresh.length
          ? pass(`${h.host}: collecting`, `${fresh.length}/${items.length} items updated in the last 10 min`)
          : fail(`${h.host}: no recent data`, `${items.length} items defined, none updated recently — agent not reporting`);
      }
    } catch (e) {
      fail("host query", e.message);
    }
  }

  // 5 ── grafana side ------------------------------------------------------
  step("5. Grafana");
  const g = async (path) => {
    const r = await fetch(`${CP}/grafana${path}`, { headers: { Authorization: auth } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  try {
    const plugins = await g("/api/plugins?type=app");
    const zbx = plugins.find((p) => p.id === "alexanderzobnin-zabbix-app");
    if (!zbx) fail("plugin installed", "GF_INSTALL_PLUGINS didn't take — check `docker compose logs grafana`");
    else if (!zbx.enabled) fail("plugin enabled", "installed but disabled — provisioning/plugins/zabbix.yml should enable it");
    else pass("plugin installed and enabled", `v${zbx.info?.version ?? "?"}`);
  } catch (e) {
    fail("plugin check", e.message);
  }

  let dsUid = null;
  try {
    const ds = await g("/api/datasources");
    const zbx = ds.find((d) => d.type === "alexanderzobnin-zabbix-datasource");
    if (zbx) { dsUid = zbx.uid; pass("datasource provisioned", `${zbx.name} -> ${zbx.url}`); }
    else fail("datasource missing", "check provisioning/datasources/cloudpulse.yml and grafana logs");
  } catch (e) {
    fail("datasource check", e.message);
  }

  if (dsUid) {
    try {
      const h = await g(`/api/datasources/uid/${dsUid}/health`);
      h.status === "OK"
        ? pass("datasource health", h.message ?? "")
        : fail("datasource health", h.message ?? JSON.stringify(h));
    } catch (e) {
      fail("datasource health", `${e.message} — usually wrong ZABBIX_API_USER/PASSWORD`);
    }
  }

  console.log("\n" + "=".repeat(40));
  console.log(failed === 0
    ? "All checks passed — Zabbix is wired end to end."
    : `${failed} check(s) failed. Fix the earliest failure first; later ones usually follow from it.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\nunexpected error:", e.message); process.exit(1); });
