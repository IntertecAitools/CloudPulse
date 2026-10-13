import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { discovery, listAccounts, type Account, type CloudResource } from "@/lib/grafana-api";
import { getProvider, loadActiveProvider, type ProviderId } from "@/lib/providers";
import { formatValue } from "@/hooks/use-metric";
import { ACCENT, STATUS_CRITICAL, STATUS_OK, STATUS_WARNING } from "@/lib/chart-theme";
import { authFetch, useRequireAuth } from "@/lib/auth";
import { useTimeRange } from "@/lib/time-range";

export const Route = createFileRoute("/infrastructure")({
  head: () => ({ meta: [{ title: "Infrastructure - CloudPulse" }] }),
  component: Infrastructure,
});

type HostRow = {
  id: string;
  label: string;
  cpu: number | null;
  cpuSeries: { v: number }[];
  netIn: number | null;
  netOut: number | null;
  /** Provider-normalised: >0 means unhealthy. */
  failures: number | null;
};

type SortKey = "label" | "cpu" | "netIn" | "netOut";

function Infrastructure() {
  useRequireAuth();
  const { range } = useTimeRange();
  const [providerId, setProviderId] = useState<ProviderId>("aws");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountUid, setAccountUid] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [scopeOverride, setScopeOverride] = useState("");
  const [rows, setRows] = useState<HostRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("cpu");
  const [sortDesc, setSortDesc] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const provider = getProvider(providerId);
  const account = accounts.find((a) => a.uid === accountUid);
  const defaultScope = provider.defaultScope(account);
  const scope = scopeOverride || defaultScope;

  useEffect(() => setProviderId(loadActiveProvider()), []);

  useEffect(() => {
    setAccounts([]); setAccountUid(""); setRows([]);
    listAccounts(providerId).then((a) => {
      setAccounts(a);
      if (a.length && a[0]) setAccountUid(a[0].uid);
    }).catch(() => {});
  }, [providerId]);

  useEffect(() => {
    setScopeOverride("");
    if (account) discovery.scopes(account).then(setScopes).catch(() => setScopes([]));
  }, [account?.uid]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;

    const load = async (initial: boolean) => {
      if (initial) { setLoading(true); setRows([]); }
      setError(null);
      const found: CloudResource[] = await discovery.resources(account, scope).catch((e: Error) => {
        if (!cancelled) setError(e.message);
        return [] as CloudResource[];
      });
      if (cancelled) return;
      if (found.length === 0) { setRows([]); setLoading(false); setUpdatedAt(new Date()); return; }

      // One query per (resource x fleet metric), built by the active provider.
      const queries = found.flatMap((resource, i) =>
        provider.fleetMetrics.map((m, j) =>
          provider.buildQuery({
            refId: `r${i}_${j}`,
            dsUid: account.uid,
            scope,
            namespace: provider.fleetNamespace,
            metricName: m.metricName,
            statistic: m.statistic,
            period: provider.defaultPeriod,
            resourceId: resource.id,
          }),
        ),
      );

      try {
        const res = await authFetch("/grafana/api/ds/query", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: `now-${range}`, to: "now", queries }),
        });
        const json = await res.json();
        if (cancelled) return;

        const values = (refId: string): number[] => {
          const frames = json?.results?.[refId]?.frames ?? [];
          const out: number[] = [];
          for (const f of frames) {
            const vals = f?.data?.values?.[1] ?? [];
            for (const v of vals) if (v != null) out.push(v);
          }
          return out;
        };
        const last = (arr: number[]) => (arr.length ? (arr[arr.length - 1] ?? null) : null);
        const indexOf = (key: string) => provider.fleetMetrics.findIndex((m) => m.key === key);

        setRows(found.map((resource, i) => {
          const cpuVals = values(`r${i}_${indexOf("cpu")}`);
          const healthRaw = last(values(`r${i}_${indexOf("health")}`));
          return {
            id: resource.id,
            label: resource.label,
            cpu: last(cpuVals),
            cpuSeries: cpuVals.map((v) => ({ v })),
            netIn: last(values(`r${i}_${indexOf("netIn")}`)),
            netOut: last(values(`r${i}_${indexOf("netOut")}`)),
            // AWS reports failures directly; Azure reports availability
            // (1 = up), so invert it into the same "failures" shape.
            failures: healthRaw === null
              ? null
              : provider.id === "azure" ? (healthRaw < 1 ? 1 : 0) : healthRaw,
          };
        }));
        setUpdatedAt(new Date());
      } catch { /* keep previous rows */ }
      setLoading(false);
    };

    load(true);
    const t = setInterval(() => load(false), 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [account?.uid, scope, range, providerId]);

  const visible = useMemo(() => {
    const filtered = rows.filter((r) => r.label.toLowerCase().includes(search.toLowerCase()));
    const dir = sortDesc ? -1 : 1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "label") return dir * a.label.localeCompare(b.label);
      const av = a[sortKey] ?? -1, bv = b[sortKey] ?? -1;
      return dir * (av - bv);
    });
  }, [rows, search, sortKey, sortDesc]);

  const clickSort = (k: SortKey) => {
    if (k === sortKey) setSortDesc((d) => !d);
    else { setSortKey(k); setSortDesc(true); }
  };
  const arrow = (k: SortKey) => (k === sortKey ? (sortDesc ? " ↓" : " ↑") : "");

  const activeCount = rows.filter((r) => r.cpu !== null).length;
  const staleCount = rows.length - activeCount;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Account
          <select value={accountUid} onChange={(e) => setAccountUid(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            {accounts.length === 0 && <option value="">-</option>}
            {accounts.map((a) => <option key={a.uid} value={a.uid}>{a.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {provider.terms.scope}
          <select value={scopeOverride} onChange={(e) => setScopeOverride(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            <option value="">{defaultScope ? `Default (${defaultScope})` : "All"}</option>
            {scopes.filter((s) => s !== defaultScope).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
          className="rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground" />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {activeCount} active{staleCount > 0 ? ` · ${staleCount} stale` : ""}
          {updatedAt ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="cursor-pointer px-4 py-3 font-medium" onClick={() => clickSort("label")}>
                {provider.id === "azure" ? "Virtual machine" : "Instance"}{arrow("label")}
              </th>
              <th className="cursor-pointer px-4 py-3 font-medium" onClick={() => clickSort("cpu")}>CPU{arrow("cpu")}</th>
              <th className="px-4 py-3 font-medium">CPU ({range})</th>
              <th className="cursor-pointer px-4 py-3 font-medium" onClick={() => clickSort("netIn")}>Net In{arrow("netIn")}</th>
              <th className="cursor-pointer px-4 py-3 font-medium" onClick={() => clickSort("netOut")}>Net Out{arrow("netOut")}</th>
              <th className="px-4 py-3 font-medium">Health</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const stale = r.cpu === null;
              return (
                <tr key={r.id} className={`border-b border-border last:border-0 ${stale ? "opacity-45" : ""}`}>
                  <td className="px-4 py-3 font-mono text-xs text-foreground" title={r.id}>{r.label}</td>
                  <td className="px-4 py-3 text-foreground">
                    {stale ? "-" : (
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-background">
                          <span className="block h-full rounded"
                            style={{
                              width: `${Math.min(100, r.cpu!)}%`,
                              background: r.cpu! > 80 ? STATUS_CRITICAL : r.cpu! > 50 ? STATUS_WARNING : STATUS_OK,
                            }} />
                        </span>
                        {formatValue(r.cpu!, "percent")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2" style={{ width: 120 }}>
                    {r.cpuSeries.length > 1 && (
                      <div style={{ width: 100, height: 28 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={r.cpuSeries} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                            <Area type="monotone" dataKey="v" stroke={ACCENT} strokeWidth={1.5}
                              fill={ACCENT} fillOpacity={0.12} dot={false} isAnimationActive={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground">{r.netIn === null ? "-" : formatValue(r.netIn, "bytes")}</td>
                  <td className="px-4 py-3 text-foreground">{r.netOut === null ? "-" : formatValue(r.netOut, "bytes")}</td>
                  <td className="px-4 py-3">
                    {stale ? (
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">no recent data</span>
                    ) : r.failures !== null && r.failures > 0 ? (
                      <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">failing</span>
                    ) : (
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">healthy</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
                {loading ? "Loading fleet..." : search ? "Nothing matches your search." : `No resources found in this ${provider.terms.scope.toLowerCase()}.`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Auto-refreshes every 60s. Values show the latest datapoint; sparkline covers the selected time range.
        {provider.id === "aws"
          ? ' "No recent data" usually means a stopped or terminated instance (CloudWatch keeps history ~2 weeks).'
          : ' "No recent data" usually means a deallocated VM, or that the guest metrics extension is not installed.'}
      </p>
    </div>
  );
}
