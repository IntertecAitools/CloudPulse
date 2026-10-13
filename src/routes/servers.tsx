import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useRequireAuth } from "@/lib/auth";
import { STATUS_CRITICAL, STATUS_OK, STATUS_WARNING } from "@/lib/chart-theme";
import {
  SEVERITY, getHosts, getProblems, isConfigured,
  type ZabbixHost, type ZabbixProblem,
} from "@/lib/zabbix";

export const Route = createFileRoute("/servers")({
  head: () => ({ meta: [{ title: "Servers - CloudPulse" }] }),
  component: Servers,
});

const TABS = ["Hosts", "Problems"] as const;

/** Zabbix severity 0-5 -> badge styling. */
const SEV_STYLE = [
  "bg-white/5 text-muted-foreground",
  "bg-sky-500/15 text-sky-300",
  "bg-yellow-500/15 text-yellow-400",
  "bg-orange-500/15 text-orange-400",
  "bg-red-500/15 text-red-400",
  "bg-red-600/25 text-red-300",
];

function Servers() {
  useRequireAuth();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [hosts, setHosts] = useState<ZabbixHost[]>([]);
  const [problems, setProblems] = useState<ZabbixProblem[]>([]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Hosts");
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => { isConfigured().then(setConfigured); }, []);

  const load = useCallback(async () => {
    if (!configured) return;
    setError(null);
    try {
      const [h, p] = await Promise.all([getHosts(), getProblems()]);
      setHosts(h); setProblems(p); setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message || "Failed to load from Zabbix");
    }
    setLoading(false);
  }, [configured]);

  useEffect(() => {
    if (configured === null) return;
    if (!configured) { setLoading(false); return; }
    setLoading(true);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [configured, load]);

  const groups = useMemo(
    () => [...new Set(hosts.flatMap((h) => h.groups))].sort(), [hosts]);

  const visibleHosts = useMemo(() => hosts.filter((h) =>
    (!group || h.groups.includes(group)) &&
    (h.name.toLowerCase().includes(search.toLowerCase()) ||
     h.address.toLowerCase().includes(search.toLowerCase()))), [hosts, search, group]);

  const visibleProblems = useMemo(() => problems.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.host.toLowerCase().includes(search.toLowerCase())), [problems, search]);

  if (configured === false) return <NotConfigured />;

  const up = hosts.filter((h) => h.availability === "up").length;
  const down = hosts.filter((h) => h.availability === "down").length;
  const unresolved = problems.filter((p) => !p.acknowledged).length;
  const highSeverity = problems.filter((p) => p.severity >= 4).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Group
          <select value={group} onChange={(e) => setGroup(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            <option value="">All groups</option>
            {groups.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
          className="rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground" />
        <a href="http://localhost:8090" target="_blank" rel="noreferrer"
          className="rounded border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Configure in Zabbix →
        </a>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {updatedAt ? `updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Hosts up" value={`${up}/${hosts.length}`} tone={down > 0 ? "bad" : "good"} />
        <Tile label="Unreachable" value={String(down)} tone={down > 0 ? "bad" : "good"} />
        <Tile label="Active problems" value={String(problems.length)} tone={problems.length > 0 ? "warn" : "good"} />
        <Tile label="High / Disaster" value={String(highSeverity)} tone={highSeverity > 0 ? "bad" : "good"}
          sub={unresolved ? `${unresolved} unacknowledged` : ""} />
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === t ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground"
            }`}>
            {t}
            <span className="ml-2 text-[11px] opacity-60">
              {t === "Hosts" ? hosts.length : problems.length}
            </span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {tab === "Hosts"
          ? <HostsTable rows={visibleHosts} loading={loading} />
          : <ProblemsTable rows={visibleProblems} loading={loading} />}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Auto-refreshes every 30s. Read from the bundled Zabbix. Add hosts, templates and triggers
        in the Zabbix UI and they appear here automatically.
      </p>
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-12 text-center">
      <p className="text-sm text-foreground">No Zabbix datasource is configured.</p>
      <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">
        Zabbix ships with CloudPulse and is provisioned into Grafana on startup. If you are seeing
        this, the stack is not fully up — try <code className="rounded bg-black/30 px-1">docker compose up -d</code>{" "}
        and check <code className="rounded bg-black/30 px-1">deploy/zabbix/README.md</code>.
      </p>
    </div>
  );
}

function Tile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad";
}) {
  const color = tone === "bad" ? STATUS_CRITICAL : tone === "warn" ? STATUS_WARNING : undefined;
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-lg font-semibold" style={color ? { color } : undefined}>{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      {sub && <p className="truncate text-[10px] text-muted-foreground/70">{sub}</p>}
    </div>
  );
}

const TH = "px-4 py-3 text-left font-medium";
const TD = "px-4 py-3 text-foreground";
const pct = (v: number | null) => (v == null ? "-" : `${v.toFixed(1)}%`);

function Bar({ percent }: { percent: number }) {
  return (
    <span className="inline-block h-1.5 w-14 overflow-hidden rounded bg-background align-middle">
      <span className="block h-full rounded" style={{
        width: `${Math.min(100, percent)}%`,
        background: percent > 85 ? STATUS_CRITICAL : percent > 60 ? STATUS_WARNING : STATUS_OK,
      }} />
    </span>
  );
}

function Metric({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  return (
    <span className="flex items-center gap-2">
      <Bar percent={value} /><span className="text-xs">{pct(value)}</span>
    </span>
  );
}

function uptimeLabel(seconds: number | null): string {
  if (seconds == null) return "-";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return d > 0 ? `${d}d ${h}h` : `${h}h`;
}

function HostsTable({ rows, loading }: { rows: ZabbixHost[]; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th className={TH}>Host</th><th className={TH}>Status</th><th className={TH}>CPU</th>
          <th className={TH}>Memory</th><th className={TH}>Disk</th><th className={TH}>Uptime</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((h) => (
          <tr key={h.hostid} className={`border-b border-border last:border-0 ${h.enabled ? "" : "opacity-45"}`}>
            <td className={TD}>
              <div className="font-mono text-xs">{h.name}</div>
              <div className="text-[10px] text-muted-foreground">{h.address}</div>
            </td>
            <td className="px-4 py-3">
              {!h.enabled ? (
                <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">disabled</span>
              ) : h.availability === "up" ? (
                <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">up</span>
              ) : h.availability === "down" ? (
                <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400" title={h.error}>unreachable</span>
              ) : (
                <span className="rounded bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">unknown</span>
              )}
            </td>
            <td className={TD}><Metric value={h.cpu} /></td>
            <td className={TD}><Metric value={h.memory} /></td>
            <td className={TD}><Metric value={h.disk} /></td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{uptimeLabel(h.uptime)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-muted-foreground">
            {loading ? "Loading..." : "No hosts match your filters."}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}

function ProblemsTable({ rows, loading }: { rows: ZabbixProblem[]; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th className={TH}>Severity</th><th className={TH}>Problem</th>
          <th className={TH}>Host</th><th className={TH}>Since</th><th className={TH}>Ack</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.eventid} className="border-b border-border last:border-0">
            <td className="px-4 py-3">
              <span className={`rounded px-2 py-0.5 text-xs ${SEV_STYLE[p.severity] ?? SEV_STYLE[0]}`}>
                {SEVERITY[p.severity] ?? "Unknown"}
              </span>
            </td>
            <td className={`${TD} text-xs`}>{p.name}</td>
            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.host}</td>
            <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(p.clock).toLocaleString()}</td>
            <td className="px-4 py-3 text-xs">
              {p.acknowledged
                ? <span className="text-emerald-400">yes</span>
                : <span className="text-muted-foreground">no</span>}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-xs text-muted-foreground">
            {loading ? "Loading..." : "No active problems."}
          </td></tr>
        )}
      </tbody>
    </table>
  );
}
