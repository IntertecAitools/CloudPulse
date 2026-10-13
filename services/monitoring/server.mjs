import "../telemetry.mjs";

import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import nodemailer from "nodemailer";

/**
 * Mail transport. Gmail is the shortcut (needs an App Password, not the
 * account password); SMTP_HOST covers everything else. Null when neither is
 * configured — notify() then says so in the log rather than failing silently,
 * which is what it used to do: the transport was built here and never once
 * used, so every rule with an email address quietly notified nobody.
 */
const mailer = (() => {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || "" }
        : undefined,
    });
  }
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    });
  }
  return null;
})();

const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_USER || "cloudpulse@localhost";

const STATE_DIR = process.env.CLOUDPULSE_STATE_DIR || "/etc/cloudpulse";
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 8083;
mkdirSync(STATE_DIR, { recursive: true });

const FILE = join(STATE_DIR, "alerts.json");
const GRAFANA = process.env.GRAFANA_URL || "http://127.0.0.1:3000";
const TOKEN = process.env.GRAFANA_TOKEN || "";
// Production issues a service-account token. The local stack has none to
// bootstrap, so fall back to Grafana's admin basic credentials.
const GRAFANA_AUTH = TOKEN
  ? `Bearer ${TOKEN}`
  : `Basic ${Buffer.from(
      `${process.env.GRAFANA_USER || "admin"}:${process.env.GRAFANA_PASSWORD || "admin"}`,
    ).toString("base64")}`;

let rules = load();

const DASH_FILE = join(STATE_DIR, "dashboards.json");
let dashboards = (() => { try { return JSON.parse(readFileSync(DASH_FILE, "utf8")); } catch { return []; } })();
function saveDash() { writeFileSync(DASH_FILE, JSON.stringify(dashboards, null, 2)); }
/**
 * Rule state: id -> { status, lastValue, lastEval, since }.
 *
 * Persisted, because it used to be in-memory only. Notifications fire on a
 * *transition* (ok -> firing), so an empty map after a restart made every
 * firing rule look newly broken and re-notify — every deploy spammed whoever
 * was on the receiving end, and `since` (how long it has been firing) reset
 * to zero.
 */
const STATE_FILE = join(STATE_DIR, "alert-state.json");
const state = new Map(
  (() => {
    try { return Object.entries(JSON.parse(readFileSync(STATE_FILE, "utf8"))); }
    catch { return []; }
  })(),
);

let statePending = null;
/** Debounced: evaluateAll touches this once per rule per minute. */
function saveState() {
  if (statePending) return;
  statePending = setTimeout(() => {
    statePending = null;
    try {
      writeFileSync(STATE_FILE, JSON.stringify(Object.fromEntries(state), null, 2));
    } catch (e) {
      console.error(`could not persist alert state: ${e.message}`);
    }
  }, 1000);
}

function load() { try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return []; } }
function save() { writeFileSync(FILE, JSON.stringify(rules, null, 2)); }

/**
 * `/subscriptions/S/resourceGroups/G/providers/Microsoft.Compute/virtualMachines/N`
 * Mirrors parseResourceUri in src/lib/providers/azure.ts — the evaluator runs
 * server-side and can't import the frontend module.
 */
function parseAzureResourceUri(uri) {
  const p = String(uri || "").split("/").filter(Boolean);
  const i = p.findIndex((x) => x.toLowerCase() === "providers");
  if (p[0]?.toLowerCase() !== "subscriptions" || i < 4 || p.length < i + 4) return null;
  const rest = p.slice(i + 1);
  const resourceName = rest[rest.length - 1];
  const metricNamespace = rest.slice(0, -1).join("/");
  if (!p[1] || !p[3] || !resourceName || !metricNamespace) return null;
  return { subscription: p[1], resourceGroup: p[3], resourceName, metricNamespace };
}

/** Build the ds/query payload for a rule, per cloud. */
function buildRuleQuery(r) {
  // `scope` is a region on AWS and a resource group on Azure. Rules written
  // before multi-provider support only have `region`.
  const scope = r.scope ?? r.region ?? "";

  if (r.provider === "azure") {
    const parsed = parseAzureResourceUri(r.resourceId);
    return {
      refId: "A",
      datasource: { type: "grafana-azure-monitor-datasource", uid: r.dsUid },
      queryType: "Azure Monitor",
      subscription: parsed?.subscription ?? "",
      azureMonitor: {
        metricNamespace: parsed?.metricNamespace ?? r.namespace,
        metricName: r.metricName,
        aggregation: r.statistic,
        timeGrain: r.period || "PT5M",
        resources: parsed
          ? [{
              subscription: parsed.subscription,
              resourceGroup: parsed.resourceGroup,
              resourceName: parsed.resourceName,
              metricNamespace: parsed.metricNamespace,
            }]
          : [],
        dimensionFilters: Object.entries(r.dimensions || {}).map(([dimension, value]) => ({
          dimension, operator: "eq", filters: [value],
        })),
        allowedTimeGrainsMs: [],
      },
    };
  }

  return {
    refId: "A",
    datasource: { type: "cloudwatch", uid: r.dsUid },
    queryMode: "Metrics", metricQueryType: 0, metricEditorMode: 0,
    namespace: r.namespace, metricName: r.metricName,
    dimensions: r.dimensions || {}, statistic: r.statistic,
    period: r.period || "300", region: scope, matchExact: true,
  };
}

/**
 * Validate and normalise an incoming rule body.
 * Note `scope` is deliberately optional: on Azure an empty resource group
 * means "whole subscription", so requiring it (as the AWS-only version did)
 * would reject every subscription-wide Azure rule.
 */
function ruleFields(data) {
  const {
    name, provider, dsUid, scope, region, namespace, metricName, statistic,
    op, threshold, period, dimensions, resourceId, webhook, email,
  } = data;

  const cloud = provider === "azure" ? "azure" : "aws";
  if (!name || !dsUid || !namespace || !metricName || !statistic)
    return { error: "Missing or invalid fields" };
  if (!["<", ">"].includes(op) || typeof threshold !== "number")
    return { error: "Missing or invalid fields" };
  if (cloud === "azure" && !resourceId)
    return { error: "Azure rules must target a resource" };
  if (cloud === "aws" && !(scope ?? region))
    return { error: "AWS rules must specify a region" };

  return {
    value: {
      name,
      provider: cloud,
      dsUid,
      scope: scope ?? region ?? "",
      namespace,
      metricName,
      statistic,
      op,
      threshold,
      period: period || (cloud === "azure" ? "PT5M" : "300"),
      dimensions: dimensions || {},
      resourceId: resourceId || "",
      webhook: webhook || "",
      email: email || "",
    },
  };
}

async function evaluateRule(r) {
  const body = { from: "now-15m", to: "now", queries: [buildRuleQuery(r)] };
  const res = await fetch(`${GRAFANA}/api/ds/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: GRAFANA_AUTH },
    body: JSON.stringify(body),
  });
  // Without this a 401/500 yields no frames, which the caller reads as
  // "no-data" -- every rule looks quiet forever while nothing is being checked.
  if (!res.ok) throw new Error(`Grafana query failed (${res.status}) for rule ${r.id}`);
  const json = await res.json();
  const frames = json?.results?.A?.frames ?? [];
  let latest = null;
  for (const f of frames) {
    const vals = f?.data?.values?.[1] ?? [];
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null) { latest = vals[i]; break; }
    if (latest != null) break;
  }
  return latest;
}

/**
 * Fan a state change out to every channel the rule configures. Channels are
 * independent: a broken webhook must not stop the email, and vice versa.
 * Failures are logged rather than swallowed — a notification that silently
 * never arrives is worse than no notification at all.
 */
async function notify(r, { firing, subject, text }) {
  const jobs = [];

  if (r.webhook) {
    jobs.push(
      fetch(r.webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `text` satisfies Slack, Discord and Mattermost incoming webhooks;
        // the rest is for anything consuming the payload programmatically.
        body: JSON.stringify({
          text,
          username: "CloudPulse",
          cloudpulse: {
            rule: r.name, status: firing ? "firing" : "resolved",
            provider: r.provider ?? "aws", namespace: r.namespace,
            metric: r.metricName, threshold: r.threshold, op: r.op,
          },
        }),
      }).then((res) => {
        if (!res.ok) throw new Error(`webhook returned ${res.status}`);
      }).catch((e) => console.error(`[alert ${r.id}] webhook failed: ${e.message}`)),
    );
  }

  if (r.email) {
    if (!mailer) {
      console.error(
        `[alert ${r.id}] email requested for ${r.email} but no mail transport is configured ` +
        `— set SMTP_HOST (or GMAIL_USER/GMAIL_PASS) on the monitoring service`,
      );
    } else {
      jobs.push(
        mailer.sendMail({ from: MAIL_FROM, to: r.email, subject, text })
          .then(() => console.log(`[alert ${r.id}] emailed ${r.email}`))
          .catch((e) => console.error(`[alert ${r.id}] email failed: ${e.message}`)),
      );
    }
  }

  await Promise.allSettled(jobs);
}

async function evaluateAll() {
  for (const r of rules) {
    if (r.enabled === false) continue;
    try {
      const latest = await evaluateRule(r);
      const prev = state.get(r.id)?.status;
      let status = "no-data";
      if (latest != null) {
        const breach = r.op === "<" ? latest < r.threshold : latest > r.threshold;
        status = breach ? "firing" : "ok";
      }
      const old = state.get(r.id) || {};
      state.set(r.id, {
        status, lastValue: latest, lastEval: Date.now(),
        since: status !== prev ? Date.now() : (old.since || Date.now()),
      });
      saveState();

      const value = typeof latest === "number" ? latest.toFixed(2) : "no data";
      const where = [r.namespace, r.metricName].filter(Boolean).join(" / ");
      const scope = r.resourceId || Object.values(r.dimensions ?? {})[0] || r.scope || "";

      if (status === "firing" && prev !== "firing") {
        await notify(r, {
          firing: true,
          subject: `[CloudPulse] FIRING: ${r.name}`,
          text:
            `🔴 CloudPulse ALERT: ${r.name}\n\n` +
            `${where} is ${value} (threshold ${r.op} ${r.threshold})\n` +
            (scope ? `Resource: ${scope}\n` : "") +
            `Cloud: ${(r.provider ?? "aws").toUpperCase()}\n` +
            `Time: ${new Date().toISOString()}`,
        });
      }
      if (status === "ok" && prev === "firing") {
        const forMs = old.since ? Date.now() - old.since : 0;
        await notify(r, {
          firing: false,
          subject: `[CloudPulse] RESOLVED: ${r.name}`,
          text:
            `🟢 CloudPulse resolved: ${r.name}\n\n` +
            `${where} is back to normal at ${value}\n` +
            (forMs ? `Was firing for ${Math.round(forMs / 60000)} min\n` : "") +
            `Time: ${new Date().toISOString()}`,
        });
      }
    } catch (e) {
      console.error(`[alert ${r.id}] evaluation failed: ${e.message}`);
    }
  }
}
setInterval(evaluateAll, 60_000);
evaluateAll();

const server = createServer((req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/dashboards") {
    return send(200, dashboards);
  }
  if (req.method === "GET" && url.pathname === "/rules") {
    return send(200, rules.map((r) => ({ ...r, state: state.get(r.id) || { status: "pending" } })));
  }

  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 8192) req.destroy(); });
  req.on("end", () => {
    let data = {};
    try { data = body ? JSON.parse(body) : {}; } catch { return send(400, { error: "Bad JSON" }); }

    if (req.method === "POST" && url.pathname === "/dashboards") {
      if (!Array.isArray(data)) return send(400, { error: "Expected an array" });
      if (JSON.stringify(data).length > 512 * 1024) return send(400, { error: "Too large" });
      dashboards = data; saveDash();
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/rules") {
      const fields = ruleFields(data);
      if (fields.error) return send(400, { error: fields.error });
      const rule = {
        id: `a-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
        ...fields.value,
        enabled: true,
      };
      rules.push(rule); save();
      evaluateAll();
      return send(200, rule);
    }
    if (req.method === "POST" && url.pathname === "/rules/update") {
      const r = rules.find((x) => x.id === data.id);
      if (!r) return send(404, { error: "Not found" });
      const fields = ruleFields(data);
      if (fields.error) return send(400, { error: fields.error });
      Object.assign(r, fields.value);
      save();
      state.delete(r.id); saveState();   // force fresh evaluation under the new definition
      evaluateAll();
      return send(200, r);
    }
    if (req.method === "POST" && url.pathname === "/rules/toggle") {
      const r = rules.find((x) => x.id === data.id);
      if (!r) return send(404, { error: "Not found" });
      r.enabled = r.enabled === false; save();
      return send(200, r);
    }
    if (req.method === "POST" && url.pathname === "/rules/delete") {
      rules = rules.filter((x) => x.id !== data.id); save(); state.delete(data.id); saveState();
      return send(200, { ok: true });
    }
    send(404, { error: "Not found" });
  });
});
server.listen(PORT, HOST, () => console.log(`alerts service on ${HOST}:${PORT}, state in ${STATE_DIR}`));
