import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useRequireAuth } from "@/lib/auth";
import { useTimeRange } from "@/lib/time-range";
import { STATUS_CRITICAL, STATUS_OK, STATUS_WARNING } from "@/lib/chart-theme";
import {
  getTrace, isConfigured, listServices, searchTraces,
  type Span, type TraceSummary,
} from "@/lib/traces";

export const Route = createFileRoute("/traces")({
  head: () => ({ meta: [{ title: "Traces - CloudPulse" }] }),
  component: Traces,
});

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`);

function Traces() {
  useRequireAuth();
  const { range } = useTimeRange();
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [service, setService] = useState("");
  const [minDuration, setMinDuration] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [spanDetail, setSpanDetail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { isConfigured().then(setConfigured); }, []);

  useEffect(() => {
    if (!configured) return;
    listServices().then(setServices).catch(() => {});
  }, [configured]);

  const load = useCallback(async () => {
    if (!configured) return;
    setError(null);
    try {
      const t = await searchTraces({
        ...(service ? { service } : {}),
        ...(minDuration ? { minDurationMs: Number(minDuration) } : {}),
        ...(errorsOnly ? { errorsOnly: true } : {}),
        range, limit: 60,
      });
      setTraces(t);
    } catch (e) {
      setError((e as Error).message || "Trace search failed");
    }
    setLoading(false);
  }, [configured, service, minDuration, errorsOnly, range]);

  useEffect(() => {
    if (configured === null) return;
    if (!configured) { setLoading(false); return; }
    setLoading(true);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [configured, load]);

  useEffect(() => {
    if (!selected) { setSpans([]); return; }
    setSpanDetail(null);
    getTrace(selected).then(setSpans).catch(() => setSpans([]));
  }, [selected]);

  if (configured === false) {
    return (
      <div className="rounded-lg border border-border bg-card px-6 py-12 text-center">
        <p className="text-sm text-foreground">No Tempo datasource is configured.</p>
        <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">
          Tempo ships with CloudPulse. Run <code className="rounded bg-black/30 px-1">docker compose up -d</code>.
        </p>
      </div>
    );
  }

  const total = spans.length ? Math.max(...spans.map((s) => s.relativeStart + s.duration)) : 1;

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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Slower than
          <input value={minDuration} onChange={(e) => setMinDuration(e.target.value.replace(/\D/g, ""))}
            placeholder="ms" className="w-20 rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground" />
        </label>
        <button onClick={() => setErrorsOnly((v) => !v)}
          className={`rounded border px-3 py-1.5 text-xs transition-colors ${
            errorsOnly ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-border bg-card text-muted-foreground"
          }`}>
          Errors only
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground">{traces.length} traces</span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="max-h-[calc(100vh-300px)] overflow-auto">
            {traces.map((t) => (
              <button key={t.traceId} onClick={() => setSelected(t.traceId)}
                className={`flex w-full items-center gap-3 border-b border-border/50 px-4 py-2.5 text-left last:border-0 transition-colors ${
                  selected === t.traceId ? "bg-accent/10" : "hover:bg-white/[0.02]"
                }`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-foreground">{t.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t.service} · {new Date(t.startTime).toLocaleTimeString([], { hour12: false })}
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px]"
                  style={{ color: t.duration > 1000 ? STATUS_CRITICAL : t.duration > 250 ? STATUS_WARNING : STATUS_OK }}>
                  {ms(t.duration)}
                </span>
              </button>
            ))}
            {traces.length === 0 && (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground">
                {loading ? "Loading..." : "No traces. Widen the time range, or send some traffic."}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {!selected ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">
              Select a trace to see its spans.
            </div>
          ) : spans.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-muted-foreground">Loading spans...</div>
          ) : (
            <div className="max-h-[calc(100vh-300px)] overflow-auto">
              <div className="border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
                <span className="font-mono">{selected.slice(0, 16)}</span>
                <span className="ml-3">{spans.length} spans · {ms(total)}</span>
              </div>
              {spans.map((s) => (
                <div key={s.spanId}>
                  <button
                    onClick={() => setSpanDetail(spanDetail === s.spanId ? null : s.spanId)}
                    className="flex w-full items-center gap-2 border-b border-border/40 px-4 py-1.5 text-left last:border-0 hover:bg-white/[0.02]">
                    <span className="w-48 shrink-0 truncate text-[11px]"
                      style={{ paddingLeft: `${s.depth * 12}px`, color: s.error ? STATUS_CRITICAL : undefined }}>
                      {s.name}
                    </span>
                    <span className="w-28 shrink-0 truncate text-[10px] text-muted-foreground">{s.service}</span>
                    {/* Waterfall: offset and width are proportional to the whole trace. */}
                    <span className="relative h-2 min-w-0 flex-1 rounded bg-background">
                      <span className="absolute h-2 rounded" style={{
                        left: `${(s.relativeStart / total) * 100}%`,
                        width: `${Math.max(0.5, (s.duration / total) * 100)}%`,
                        background: s.error ? STATUS_CRITICAL : STATUS_OK,
                      }} />
                    </span>
                    <span className="w-16 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                      {ms(s.duration)}
                    </span>
                  </button>
                  {spanDetail === s.spanId && (
                    <div className="flex flex-wrap gap-1.5 border-b border-border/40 bg-background/40 px-4 py-2">
                      {Object.entries(s.tags).slice(0, 24).map(([k, v]) => (
                        <span key={k} className="rounded bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {k}=<span className="text-foreground/80">{v.slice(0, 60)}</span>
                        </span>
                      ))}
                      {Object.keys(s.tags).length === 0 && (
                        <span className="text-[10px] text-muted-foreground">no attributes</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        OpenTelemetry traces stored in Tempo. CloudPulse instruments its own services; point any
        OTLP exporter at port 4317 (gRPC) or 4318 (HTTP) to add your own.
      </p>
    </div>
  );
}
