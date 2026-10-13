import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useRequireAuth } from "@/lib/auth";
import { useTimeRange } from "@/lib/time-range";
import { discoverLabelValues, isConfigured, searchLogs, type LogLine } from "@/lib/logs";

export const Route = createFileRoute("/logs")({
  head: () => ({ meta: [{ title: "Logs - CloudPulse" }] }),
  component: Logs,
});

const LEVELS = ["error", "warn", "info", "debug"] as const;

const LEVEL_STYLE: Record<LogLine["level"], string> = {
  error: "text-red-400",
  warn: "text-yellow-400",
  info: "text-sky-300",
  debug: "text-muted-foreground",
  unknown: "text-muted-foreground",
};

function Logs() {
  useRequireAuth();
  const { range } = useTimeRange();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState("");
  const [levels, setLevels] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => { isConfigured().then(setConfigured); }, []);

  useEffect(() => {
    if (!configured) return;
    discoverLabelValues("service").then(setServices).catch(() => {});
  }, [configured]);

  const selector = useMemo(
    () => (service ? `{job="docker",service="${service}"}` : `{job="docker"}`),
    [service],
  );

  const load = useCallback(async () => {
    if (!configured) return;
    setError(null);
    try {
      const result = await searchLogs({
        selector,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(levels.length ? { levels } : {}),
        range,
        limit: 300,
      });
      setLines(result);
      setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message || "Log query failed");
    }
    setLoading(false);
  }, [configured, selector, search, levels, range]);

  useEffect(() => {
    if (configured === null) return;
    if (!configured) { setLoading(false); return; }
    setLoading(true);
    load();
  }, [configured, load]);

  // Separate from the initial load so toggling Live doesn't refetch twice.
  useEffect(() => {
    if (!live || !configured) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [live, configured, load]);

  const toggleLevel = (l: string) =>
    setLevels((cur) => (cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l]));

  if (configured === false) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm text-foreground">No Loki datasource is configured.</p>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">
          Loki ships with CloudPulse and is provisioned into Grafana on startup. Run{" "}
          <code className="rounded bg-black/30 px-1">docker compose up -d</code> to bring it up.
        </p>
      </div>
    );
  }

  const counts = {
    error: lines.filter((l) => l.level === "error").length,
    warn: lines.filter((l) => l.level === "warn").length,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Service
          <select value={service} onChange={(e) => setService(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            <option value="">All services</option>
            {services.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <div className="flex items-center gap-1">
          {LEVELS.map((l) => (
            <button key={l} onClick={() => toggleLevel(l)}
              className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                levels.includes(l)
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}>
              {l}
            </button>
          ))}
        </div>

        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search log text..."
          className="min-w-[220px] flex-1 rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground" />

        <button onClick={() => setLive((v) => !v)}
          className={`rounded border px-3 py-1.5 text-xs transition-colors ${
            live ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-card text-muted-foreground"
          }`}>
          {live ? "Live" : "Paused"}
        </button>

        <span className="text-[11px] text-muted-foreground">
          {updatedAt ? updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>
      )}

      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span>{lines.length} lines</span>
        {counts.error > 0 && <span className="text-red-400">{counts.error} errors</span>}
        {counts.warn > 0 && <span className="text-yellow-400">{counts.warn} warnings</span>}
        <span className="ml-auto font-mono opacity-60">{selector}</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="max-h-[calc(100vh-320px)] overflow-auto font-mono text-[11px] leading-relaxed">
          {lines.map((l) => (
            <div key={l.id}
              onClick={() => setExpanded(expanded === l.id ? null : l.id)}
              className="cursor-pointer border-b border-border/50 px-4 py-1.5 last:border-0 hover:bg-white/[0.02]">
              <div className="flex gap-3">
                <span className="shrink-0 text-muted-foreground">
                  {new Date(l.time).toLocaleTimeString([], { hour12: false })}
                </span>
                <span className="w-24 shrink-0 truncate text-muted-foreground/80">
                  {l.labels["service"] ?? ""}
                </span>
                <span className={`w-12 shrink-0 ${LEVEL_STYLE[l.level]}`}>
                  {l.level === "unknown" ? "" : l.level}
                </span>
                <span className={`min-w-0 flex-1 ${expanded === l.id ? "" : "truncate"} text-foreground/90`}>
                  {l.line}
                </span>
              </div>
              {expanded === l.id && (
                <div className="mt-2 flex flex-wrap gap-1.5 pl-3">
                  {Object.entries(l.labels).map(([k, v]) => (
                    <span key={k} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {k}=<span className="text-foreground/80">{v}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
          {lines.length === 0 && (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              {loading ? "Loading..." : "No log lines match. Try widening the time range."}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Container logs collected by Alloy into Loki. Click a line for its labels. To ship logs from
        another host, point its Alloy or Promtail at this Loki.
      </p>
    </div>
  );
}
