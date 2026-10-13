import { authFetch } from "@/lib/auth";

/**
 * Distributed tracing over Tempo.
 *
 * As with Loki, the datasource resource routes 404 — `/resources/api/search`
 * is not exposed — so everything goes through /api/ds/query. The working
 * query type is `traceql`; `nativeSearch` is rejected outright by this
 * plugin version.
 */

export const TEMPO_UID = "cloudpulse-tempo";

export type TraceSummary = {
  traceId: string;
  service: string;
  name: string;
  /** Milliseconds. */
  duration: number;
  startTime: number;
};

export type Span = {
  spanId: string;
  parentSpanId: string;
  name: string;
  service: string;
  /** Milliseconds from trace start. */
  relativeStart: number;
  duration: number;
  tags: Record<string, string>;
  error: boolean;
  depth: number;
};

async function dsQuery(query: Record<string, unknown>, from = "now-1h") {
  const r = await authFetch("/grafana/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: "now",
      queries: [{
        refId: "A",
        datasource: { type: "tempo", uid: TEMPO_UID },
        intervalMs: 1000,
        maxDataPoints: 100,
        ...query,
      }],
    }),
  });
  if (!r.ok) throw new Error(`Trace query failed (${r.status})`);
  const json = await r.json();
  const err = json?.results?.A?.error;
  if (err) throw new Error(String(err));
  return json?.results?.A?.frames ?? [];
}

/** Column accessor by field name — field order is not guaranteed. */
function columns(frame: { schema?: { fields?: { name: string }[] }; data?: { values?: unknown[][] } }) {
  const names = (frame?.schema?.fields ?? []).map((f) => f.name);
  return (n: string): unknown[] => {
    const i = names.indexOf(n);
    return i === -1 ? [] : (frame?.data?.values?.[i] ?? []);
  };
}

/**
 * TraceQL search. An empty `{}` matches everything; a service filter becomes
 * `{resource.service.name="x"}`, and minDuration uses TraceQL's duration
 * comparison so the filtering happens in Tempo, not the browser.
 */
export async function searchTraces(opts: {
  service?: string;
  minDurationMs?: number;
  errorsOnly?: boolean;
  range?: string;
  limit?: number;
} = {}): Promise<TraceSummary[]> {
  const filters: string[] = [];
  if (opts.service) filters.push(`resource.service.name="${opts.service.replace(/"/g, "")}"`);
  if (opts.minDurationMs) filters.push(`duration > ${Math.round(opts.minDurationMs)}ms`);
  if (opts.errorsOnly) filters.push(`status = error`);
  const query = filters.length ? `{${filters.join(" && ")}}` : "{}";

  const frames = await dsQuery({
    queryType: "traceql", query, limit: opts.limit ?? 50, tableType: "traces",
  }, `now-${opts.range ?? "1h"}`);

  const out: TraceSummary[] = [];
  for (const frame of frames) {
    const col = columns(frame);
    const ids = col("traceID");
    const starts = col("startTime");
    const services = col("traceService");
    const names = col("traceName");
    const durations = col("traceDuration");
    for (let i = 0; i < ids.length; i++) {
      out.push({
        traceId: String(ids[i]),
        service: String(services[i] ?? ""),
        name: String(names[i] ?? ""),
        duration: Number(durations[i]) || 0,
        startTime: Number(starts[i]) || 0,
      });
    }
  }
  return out.sort((a, b) => b.startTime - a.startTime);
}

/**
 * Full span list for one trace, ordered and depth-annotated for a waterfall.
 *
 * Uses queryType "traceId", not "traceql": TraceQL only parses `{...}`
 * selectors, so passing a bare trace ID fails with
 * "syntax error: unexpected IDENTIFIER".
 */
export async function getTrace(traceId: string): Promise<Span[]> {
  const frames = await dsQuery({ queryType: "traceId", query: traceId });

  const raw: (Omit<Span, "depth" | "relativeStart"> & { startTime: number })[] = [];
  for (const frame of frames) {
    const col = columns(frame);
    const ids = col("spanID");
    if (ids.length === 0) continue;
    const parents = col("parentSpanID");
    const names = col("operationName");
    const services = col("serviceName");
    const starts = col("startTime");
    const durations = col("duration");
    const tagCol = col("tags");
    const statusCol = col("statusCode");

    for (let i = 0; i < ids.length; i++) {
      const tagList = (tagCol[i] ?? []) as { key: string; value: unknown }[];
      const tags: Record<string, string> = {};
      for (const t of Array.isArray(tagList) ? tagList : []) {
        if (t?.key) tags[t.key] = String(t.value ?? "");
      }
      raw.push({
        spanId: String(ids[i]),
        parentSpanId: String(parents[i] ?? ""),
        name: String(names[i] ?? ""),
        service: String(services[i] ?? ""),
        startTime: Number(starts[i]) || 0,
        duration: Number(durations[i]) || 0,
        tags,
        // 2 is STATUS_CODE_ERROR in the OTel spec.
        error: Number(statusCol[i]) === 2 || tags["error"] === "true",
      });
    }
  }
  if (raw.length === 0) return [];

  const base = Math.min(...raw.map((s) => s.startTime));
  const byParent = new Map<string, typeof raw>();
  for (const s of raw) {
    byParent.set(s.parentSpanId, [...(byParent.get(s.parentSpanId) ?? []), s]);
  }

  // Walk the tree so children sit under their parent, rather than sorting by
  // start time — concurrent spans would otherwise interleave unreadably.
  const ordered: Span[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string, depth: number) => {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.startTime - b.startTime);
    for (const c of children) {
      if (seen.has(c.spanId)) continue;
      seen.add(c.spanId);
      ordered.push({ ...c, depth, relativeStart: c.startTime - base });
      walk(c.spanId, depth + 1);
    }
  };
  // Roots are spans whose parent isn't in this trace.
  const known = new Set(raw.map((s) => s.spanId));
  for (const s of raw) {
    if (!known.has(s.parentSpanId) && !seen.has(s.spanId)) {
      seen.add(s.spanId);
      ordered.push({ ...s, depth: 0, relativeStart: s.startTime - base });
      walk(s.spanId, 1);
    }
  }
  return ordered;
}

/** Services currently emitting traces, derived from a recent search. */
export async function listServices(range = "6h"): Promise<string[]> {
  const traces = await searchTraces({ range, limit: 200 }).catch(() => [] as TraceSummary[]);
  return [...new Set(traces.map((t) => t.service).filter(Boolean))].sort();
}

export async function isConfigured(): Promise<boolean> {
  try {
    const r = await authFetch("/grafana/api/datasources");
    if (!r.ok) return false;
    const all = await r.json();
    return (Array.isArray(all) ? all : []).some((d: { type?: string }) => d.type === "tempo");
  } catch {
    return false;
  }
}
