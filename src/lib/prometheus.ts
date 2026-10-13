import { authFetch } from "@/lib/auth";

/**
 * Thin PromQL client.
 *
 * Goes through Grafana's datasource resource proxy rather than /api/ds/query,
 * because for tabular data the native Prometheus response (a list of
 * {metric, value} samples) is far easier to work with than Grafana's frame
 * format. Charts still use ds/query via useMetric. Auth and the Grafana
 * credential injection are identical either way — both ride the same
 * /grafana/ path through nginx.
 */

export const PROMETHEUS_UID = "cloudpulse-prometheus";

export type Sample = { metric: Record<string, string>; value: number };

const base = `/grafana/api/datasources/uid/${PROMETHEUS_UID}/resources/api/v1`;

export async function promQuery(expr: string): Promise<Sample[]> {
  const r = await authFetch(`${base}/query?query=${encodeURIComponent(expr)}`);
  if (!r.ok) throw new Error(`Prometheus query failed (${r.status})`);
  const j = await r.json();
  if (j?.status !== "success") throw new Error(j?.error || "Prometheus query failed");
  return (j?.data?.result ?? []).map((x: { metric?: Record<string, string>; value?: [number, string] }) => ({
    metric: x.metric ?? {},
    value: Number(x.value?.[1] ?? NaN),
  }));
}

/**
 * Runs several queries in ONE round trip via Grafana's /api/ds/query, which
 * accepts a batch. Doing these as individual /api/v1/query calls meant ~29
 * requests per page refresh, and browsers cap concurrent connections per
 * origin at 6 — the Kubernetes page took over 5 seconds to fill in.
 *
 * A query that errors yields an empty result rather than failing the batch.
 */
export async function promQueryAll(exprs: Record<string, string>): Promise<Record<string, Sample[]>> {
  const keys = Object.keys(exprs);
  if (keys.length === 0) return {};

  const queries = keys.map((k, i) => ({
    refId: `q${i}`,
    datasource: { type: "prometheus", uid: PROMETHEUS_UID },
    expr: exprs[k],
    instant: true,
    maxDataPoints: 1,
  }));

  const r = await authFetch("/grafana/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "now-5m", to: "now", queries }),
  });
  if (!r.ok) throw new Error(`Prometheus query failed (${r.status})`);
  const json = await r.json();

  const out: Record<string, Sample[]> = {};
  keys.forEach((key, i) => {
    const frames = json?.results?.[`q${i}`]?.frames ?? [];
    const samples: Sample[] = [];
    for (const frame of frames) {
      // An instant query yields one frame per series: field[0] is time,
      // field[1] carries the value plus that series' labels.
      const valueField = frame?.schema?.fields?.[1];
      const value = Number(frame?.data?.values?.[1]?.[0]);
      if (!valueField || Number.isNaN(value)) continue;
      samples.push({ metric: valueField.labels ?? {}, value });
    }
    out[key] = samples;
  });
  return out;
}

export async function promLabelValues(label: string): Promise<string[]> {
  try {
    const r = await authFetch(`${base}/label/${encodeURIComponent(label)}/values`);
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j?.data) ? j.data.filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** First sample's value, or null. */
export function scalar(samples: Sample[]): number | null {
  const v = samples[0]?.value;
  return v === undefined || Number.isNaN(v) ? null : v;
}

/**
 * Composite key for joining samples across queries.
 *
 * Both sides of every join must build the key the same way, so this is the
 * single place the separator is defined — indexing and lookup previously used
 * different ones, and because Array.join never emits a separator for a
 * one-element array, single-label joins silently worked while every
 * two-label join missed.
 *
 * "" (unit separator) can't appear in a Prometheus label value, so it
 * can't collide the way a space or "/" could.
 */
export function joinKey(...parts: (string | undefined)[]): string {
  return parts.map((p) => p ?? "").join("");
}

/** Index samples by one or more labels so rows can be joined without N queries. */
export function byLabel(samples: Sample[], ...labels: string[]): Map<string, Sample> {
  const m = new Map<string, Sample>();
  for (const s of samples) {
    m.set(joinKey(...labels.map((l) => s.metric[l])), s);
  }
  return m;
}

/**
 * Escapes a value for use inside a PromQL label matcher. Namespace and
 * cluster values come from dropdowns populated by discovery, but they
 * originate in cluster data rather than our own code.
 */
export function promQuote(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Builds a `{a="1",b="2"}` selector, skipping empty values. */
export function selector(labels: Record<string, string | undefined>): string {
  const parts = Object.entries(labels)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}="${promQuote(v as string)}"`);
  return parts.length ? `{${parts.join(",")}}` : "";
}
