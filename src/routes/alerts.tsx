import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { discovery, listAccounts, type Account, type CloudResource } from "@/lib/grafana-api";
import { getProvider, loadActiveProvider, type ProviderId } from "@/lib/providers";
import { authFetch, useRequireAuth } from "@/lib/auth";

export const Route = createFileRoute("/alerts")({
  head: () => ({ meta: [{ title: "Alerts - CloudPulse" }] }),
  component: Alerts,
});

type RuleState = { status: "firing" | "ok" | "no-data" | "pending"; lastValue?: number | null; since?: number };
type Rule = {
  id: string;
  name: string;
  provider?: ProviderId;
  dsUid: string;
  /** Region on AWS, resource group on Azure. Older records carry `region`. */
  scope?: string;
  region?: string;
  namespace: string;
  metricName: string;
  statistic: string;
  op: "<" | ">";
  threshold: number;
  dimensions: Record<string, string>;
  resourceId?: string;
  webhook: string;
  email?: string;
  enabled: boolean;
  state: RuleState;
};

const scopeOf = (r: Rule) => r.scope ?? r.region ?? "";

function Alerts() {
  useRequireAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editRule, setEditRule] = useState<Rule | null>(null);

  const refresh = () =>
    authFetch("/alerts-api/rules").then((r) => r.json()).then(setRules).catch(() => {});

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const toggle = (id: string) =>
    authFetch("/alerts-api/rules/toggle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(refresh);

  const remove = (id: string) => {
    if (!window.confirm("Delete this alert rule?")) return;
    authFetch("/alerts-api/rules/delete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).then(refresh);
  };

  const badge = (s: RuleState["status"]) => {
    if (s === "firing") return <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">firing</span>;
    if (s === "ok") return <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">ok</span>;
    if (s === "no-data") return <span className="rounded bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">no data</span>;
    return <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">pending</span>;
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Rules are evaluated every 60 seconds against the latest datapoint.</p>
        <button onClick={() => setShowForm(true)}
          className="rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-white/5">
          + New alert
        </button>
      </div>

      {showForm && <RuleForm initial={editRule} onDone={() => { setShowForm(false); setEditRule(null); refresh(); }} onCancel={() => { setShowForm(false); setEditRule(null); }} />}

      <div className="space-y-3">
        {rules.map((r) => {
          const p = getProvider(r.provider ?? "aws");
          return (
            <div key={r.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 ${r.enabled === false ? "opacity-50" : ""}`}>
              {badge(r.enabled === false ? "pending" : r.state.status)}
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded text-[8px] font-bold text-white"
                style={{ background: p.color }} title={p.label}>{p.short}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{r.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {r.namespace} / {r.metricName} ({r.statistic}) {r.op} {r.threshold}
                  {Object.entries(r.dimensions ?? {}).map(([k, v]) => ` · ${k}=${v}`)}
                  {r.resourceId ? ` · ${r.resourceId.split("/").pop()}` : ""}
                  {scopeOf(r) ? ` · ${scopeOf(r)}` : ""}
                  {r.state.lastValue != null && ` · latest: ${Number(r.state.lastValue).toFixed(2)}`}
                  {r.email ? ` · ✉ ${r.email}` : ""}
                </p>
              </div>
              <button onClick={() => { setEditRule(r); setShowForm(true); }} className="text-xs text-muted-foreground hover:text-primary">Edit</button>
              <button onClick={() => toggle(r.id)} className="text-xs text-muted-foreground hover:text-foreground">
                {r.enabled === false ? "Enable" : "Disable"}
              </button>
              <button onClick={() => remove(r.id)} className="text-xs text-muted-foreground hover:text-red-400">Delete</button>
            </div>
          );
        })}
        {rules.length === 0 && !showForm && (
          <div className="rounded-lg border border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No alert rules yet — create one to start monitoring thresholds.
          </div>
        )}
      </div>
    </div>
  );
}

function RuleForm({ initial, onDone, onCancel }: { initial?: Rule | null; onDone: () => void; onCancel: () => void }) {
  const init = initial ?? null;
  const [providerId, setProviderId] = useState<ProviderId>(init?.provider ?? "aws");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [dsUid, setDsUid] = useState(init?.dsUid ?? "");
  const [scopes, setScopes] = useState<string[]>([]);
  const [scopeOverride, setScopeOverride] = useState(init ? scopeOf(init) : "");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState(init?.namespace ?? "");
  const [metrics, setMetrics] = useState<string[]>([]);
  const [metricName, setMetricName] = useState(init?.metricName ?? "");
  const [statistic, setStatistic] = useState(init?.statistic ?? "Average");
  const [op, setOp] = useState<"<" | ">">(init?.op ?? ">");
  const [threshold, setThreshold] = useState(init ? String(init.threshold) : "80");
  const [name, setName] = useState(init?.name ?? "");
  const [webhook, setWebhook] = useState(init?.webhook ?? "");
  const [email, setEmail] = useState(init?.email ?? "");
  const [resources, setResources] = useState<CloudResource[]>([]);
  const [resourceId, setResourceId] = useState(init?.resourceId ?? "");
  const [dimKeys, setDimKeys] = useState<string[]>([]);
  const initDimKey = init ? Object.keys(init.dimensions ?? {})[0] ?? "" : "";
  const [dimKey, setDimKey] = useState(initDimKey);
  const [dimValues, setDimValues] = useState<string[]>([]);
  const [dimValue, setDimValue] = useState(initDimKey ? (init?.dimensions?.[initDimKey] ?? "") : "");
  const [error, setError] = useState<string | null>(null);

  const provider = getProvider(providerId);
  const account = accounts.find((a) => a.uid === dsUid);
  const defaultScope = provider.defaultScope(account);
  const scope = scopeOverride || defaultScope;
  /* Azure addresses metrics by resource URI, so a rule must name one.
     AWS scopes with dimensions instead, which stay optional. */
  const needsResource = provider.id === "azure";

  useEffect(() => { if (!init) setProviderId(loadActiveProvider()); }, []);

  useEffect(() => {
    listAccounts(providerId).then((a) => {
      setAccounts(a);
      setDsUid((cur) => (a.some((x) => x.uid === cur) ? cur : (a[0]?.uid ?? "")));
    }).catch(() => {});
  }, [providerId]);

  useEffect(() => {
    if (!account) return;
    discovery.scopes(account).then(setScopes).catch(() => setScopes([]));
  }, [account?.uid]);

  useEffect(() => {
    if (!account) return;
    discovery.namespaces(account, scope).then((n) => {
      setNamespaces(n);
      setNamespace((cur) => (cur && n.includes(cur) ? cur : (n[0] ?? provider.fleetNamespace)));
    }).catch(() => {});
  }, [account?.uid, scope]);

  useEffect(() => {
    if (!account || !namespace) return;
    discovery.metrics(account, scope, namespace).then((m) => {
      setMetrics(m);
      setMetricName((cur) => (cur && m.includes(cur) ? cur : (m[0] ?? "")));
    }).catch(() => {});
  }, [account?.uid, scope, namespace]);

  useEffect(() => {
    if (!account || !needsResource) { setResources([]); return; }
    discovery.resources(account, scope).then((found) => {
      setResources(found);
      setResourceId((cur) => (found.some((r) => r.id === cur) ? cur : (found[0]?.id ?? "")));
    }).catch(() => {});
  }, [account?.uid, scope, needsResource]);

  useEffect(() => {
    if (!account || !metricName || needsResource) { setDimKeys([]); return; }
    discovery.dimensionKeys(account, scope, namespace, metricName).then(setDimKeys).catch(() => {});
  }, [account?.uid, scope, namespace, metricName, needsResource]);

  useEffect(() => {
    if (!account || !dimKey) { setDimValues([]); setDimValue(""); return; }
    discovery.dimensionValues(account, scope, namespace, metricName, dimKey).then((v) => {
      setDimValues(v);
      setDimValue((cur) => (cur && v.includes(cur) ? cur : (v[0] ?? "")));
    }).catch(() => {});
  }, [account?.uid, scope, namespace, metricName, dimKey]);

  // The two clouds don't share an aggregation vocabulary ("Sum" vs "Total").
  useEffect(() => {
    setStatistic((cur) => (provider.statistics.includes(cur) ? cur : (provider.statistics[0] ?? "Average")));
  }, [providerId]);

  const submit = async () => {
    setError(null);
    const t = parseFloat(threshold);
    if (Number.isNaN(t)) { setError("Threshold must be a number"); return; }
    if (needsResource && !resourceId) { setError(`Select a ${provider.terms.resource.toLowerCase()} to monitor`); return; }
    const res = await authFetch(init ? "/alerts-api/rules/update" : "/alerts-api/rules", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(init ? { id: init.id } : {}),
        name: name.trim() || `${metricName} ${op} ${threshold}`,
        provider: providerId,
        dsUid, scope, namespace, metricName, statistic, op, threshold: t,
        period: provider.defaultPeriod,
        resourceId: needsResource ? resourceId : "",
        dimensions: !needsResource && dimKey && dimValue ? { [dimKey]: dimValue } : {},
        webhook: webhook.trim(),
        email: email.trim(),
      }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); setError(j.error || "Failed to save"); return; }
    onDone();
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{init ? "Edit alert rule" : "New alert rule"}</h3>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:underline">Cancel</button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Sel label="Cloud" value={providerId} onChange={(v) => setProviderId(v as ProviderId)}
          options={[{ v: "aws", l: "Amazon Web Services" }, { v: "azure", l: "Microsoft Azure" }]} />
        <Sel label="Account" value={dsUid} onChange={setDsUid}
          options={accounts.map((a) => ({ v: a.uid, l: a.name }))} />
        <Sel label={provider.terms.scope} value={scopeOverride} onChange={setScopeOverride}
          options={[{ v: "", l: defaultScope ? `Default (${defaultScope})` : "All" },
            ...scopes.filter((s) => s !== defaultScope).map((s) => ({ v: s, l: s }))]} />
        <Sel label={provider.terms.namespace} value={namespace} onChange={setNamespace}
          options={namespaces.map((n) => ({ v: n, l: n }))} />
        <Sel label="Metric" value={metricName} onChange={setMetricName}
          options={metrics.map((m) => ({ v: m, l: m }))} />
        <Sel label={provider.terms.statistic} value={statistic} onChange={setStatistic}
          options={provider.statistics.map((s) => ({ v: s, l: s }))} />

        {needsResource ? (
          <Sel label={provider.terms.resource} value={resourceId} onChange={setResourceId}
            options={resources.map((r) => ({ v: r.id, l: r.label }))} />
        ) : (
          <>
            <Sel label="Resource (optional)" value={dimKey} onChange={setDimKey}
              options={[{ v: "", l: "Any / aggregate" }, ...dimKeys.map((k) => ({ v: k, l: k }))]} />
            {dimKey && (
              <Sel label="Value" value={dimValue} onChange={setDimValue}
                options={dimValues.map((v) => ({ v, l: v }))} />
            )}
          </>
        )}

        <label className="block text-xs text-muted-foreground">Condition
          <div className="mt-1 flex gap-2">
            <select value={op} onChange={(e) => setOp(e.target.value as "<" | ">")}
              className="rounded border border-border bg-background px-2 py-2 text-sm text-foreground">
              <option value=">">above</option>
              <option value="<">below</option>
            </select>
            <input value={threshold} onChange={(e) => setThreshold(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </div>
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-2">Name (optional)
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="High CPU on prod"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-3">Email (optional — notifies on fire/resolve)
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
        <label className="block text-xs text-muted-foreground sm:col-span-3">Webhook URL (optional — Slack, Discord, or any endpoint)
          <input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/..."
            className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
        </label>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button onClick={submit} disabled={!dsUid || !metricName}
        className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
        {init ? "Save changes" : "Create alert"}
      </button>
    </div>
  );
}

function Sel({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <label className="block text-xs text-muted-foreground">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-border bg-background px-2 py-2 text-sm text-foreground">
        {options.length === 0 && <option value="">-</option>}
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}
