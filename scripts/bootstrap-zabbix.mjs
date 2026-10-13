#!/usr/bin/env node
/**
 * Makes the bundled Zabbix actually monitor something on a fresh install.
 *
 * Zabbix ships a "Zabbix server" host whose agent interface points at
 * 127.0.0.1. That is correct for an all-in-one install, but here the agent
 * runs in its own container, so the interface resolves to the *server*
 * container and every check fails with "Connection refused". The host then
 * only collects Zabbix's own internal metrics -- no CPU, memory or disk.
 *
 * This points that interface at the agent container and attaches the Linux
 * template. Idempotent: safe to re-run, and a no-op once correct.
 */

const API = process.env.ZABBIX_API_URL ?? "http://zabbix-web:8080/api_jsonrpc.php";
const USER = process.env.ZABBIX_API_USER ?? "Admin";
const PASS = process.env.ZABBIX_API_PASSWORD ?? "zabbix";
const AGENT_HOST = process.env.ZABBIX_AGENT_HOST ?? "zabbix-agent";
const TEMPLATE = process.env.ZABBIX_LINUX_TEMPLATE ?? "Linux by Zabbix agent";

let auth = null;

async function rpc(method, params) {
  const body = { jsonrpc: "2.0", method, params, id: 1 };
  // apiinfo.version must not carry an auth token.
  if (auth && method !== "apiinfo.version" && method !== "user.login") body.auth = auth;
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json-rpc" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message} ${j.error.data ?? ""}`);
  return j.result;
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try {
      const v = await rpc("apiinfo.version", {});
      console.log(`zabbix api ready (${v})`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  throw new Error(`Zabbix API never became ready at ${API}`);
}

async function main() {
  await waitForApi();
  auth = await rpc("user.login", { username: USER, password: PASS });

  const [host] = await rpc("host.get", {
    filter: { host: ["Zabbix server"] },
    selectInterfaces: ["interfaceid", "dns", "useip", "port"],
    selectParentTemplates: ["templateid", "host"],
    output: ["hostid", "host"],
  });
  if (!host) { console.log("no 'Zabbix server' host — nothing to do"); return; }

  const iface = host.interfaces?.[0];
  if (!iface) { console.log("host has no agent interface — skipping"); return; }

  if (iface.dns === AGENT_HOST && iface.useip === "0") {
    console.log(`interface already points at ${AGENT_HOST}`);
  } else {
    await rpc("hostinterface.update", {
      interfaceid: iface.interfaceid, useip: 0, dns: AGENT_HOST, port: "10050",
    });
    console.log(`interface -> ${AGENT_HOST}:10050 (was ${iface.useip === "1" ? "ip" : "dns"} ${iface.dns || "127.0.0.1"})`);
  }

  if ((host.parentTemplates ?? []).some((t) => t.host === TEMPLATE)) {
    console.log(`template "${TEMPLATE}" already attached`);
  } else {
    const [tpl] = await rpc("template.get", { output: ["templateid"], filter: { host: [TEMPLATE] } });
    if (!tpl) { console.log(`template "${TEMPLATE}" not found — skipping`); return; }
    await rpc("host.update", { hostid: host.hostid, templates: [{ templateid: tpl.templateid }] });
    console.log(`attached template "${TEMPLATE}"`);
  }

  console.log("bootstrap complete — OS metrics should appear within a minute");
}

main().catch((e) => { console.error("bootstrap failed:", e.message); process.exit(1); });
