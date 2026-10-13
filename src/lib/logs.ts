import { authFetch } from "@/lib/auth";

/**
 * Log search over Loki.
 *
 * Queries go through /api/ds/query like every other datasource. Two things
 * that are easy to get wrong and cost a while to find:
 *  - `intervalMs` and `maxDataPoints` are required. Without them the plugin
 *    fails with a bare "An error occurred within the plugin" and no detail.
 *  - Label discovery is NOT available on the datasource resource route the
 *    way it is for Prometheus (`/resources/...` 404s), so labels are derived
 *    from a cheap sample query instead.
 */

export const LOKI_UID = "cloudpulse-loki";

export type LogLine = {
  id: string;
  time: number;
  line: string;
  labels: Record<string, string>;
  /** Normalised from Loki's detected_level / level labels. */
  level: "error" | "warn" | "info" | "debug" | "unknown";
};

export type LogQuery = {
  /** Loki label selector, e.g. {service="grafana"}. */
  selector: string;
  /** Free text; becomes a case-insensitive line filter. */
  search?: string;
  levels?: string[];
  range: string;
  limit?: number;
};

function normaliseLevel(labels: Record<string, string>, line: string): LogLine["level"] {
  const raw = (labels["detected_level"] ?? labels["level"] ?? "").toLowerCase();
  if (raw.startsWith("err") || raw === "fatal" || raw === "panic") return "error";
  if (raw.startsWith("warn")) return "warn";
  if (raw === "info") return "info";
  if (raw === "debug" || raw === "trace") return "debug";
  // Fall back to the line itself — plenty of images log without a level label.
  if (/\b(error|fatal|panic)\b/i.test(line)) return "error";
  if (/\bwarn(ing)?\b/i.test(line)) return "warn";
  return "unknown";
}

/** Escapes a value for use inside a LogQL string literal. */
function esc(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildExpr(q: LogQuery): string {
  let expr = q.selector || `{job="docker"}`;
  if (q.search?.trim()) expr += ` |~ "(?i)${esc(q.search.trim())}"`;
  if (q.levels?.length) {
    // Match on the label when present, and on the raw line when it is not.
    const alt = q.levels.map((l) => esc(l)).join("|");
    expr += ` |~ "(?i)(${alt})"`;
  }
  return expr;
}

export async function searchLogs(q: LogQuery): Promise<LogLine[]> {
  const body = {
    from: `now-${q.range}`,
    to: "now",
    queries: [{
      refId: "A",
      datasource: { type: "loki", uid: LOKI_UID },
      expr: buildExpr(q),
      queryType: "range",
      maxLines: q.limit ?? 200,
      // Required — see the note at the top of this file.
      intervalMs: 1000,
      maxDataPoints: 100,
    }],
  };

  const r = await authFetch("/grafana/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Log query failed (${r.status})`);
  const json = await r.json();

  const err = json?.results?.A?.error;
  if (err) throw new Error(String(err));

  const out: LogLine[] = [];
  for (const frame of json?.results?.A?.frames ?? []) {
    const names: string[] = (frame?.schema?.fields ?? []).map((f: { name: string }) => f.name);
    const col = (n: string) => {
      const i = names.indexOf(n);
      return i === -1 ? [] : (frame?.data?.values?.[i] ?? []);
    };
    const labels = col("labels");
    const times = col("Time");
    const lines = col("Line");
    const ids = col("id");

    for (let i = 0; i < lines.length; i++) {
      const lab = (labels[i] ?? {}) as Record<string, string>;
      const line = String(lines[i] ?? "");
      out.push({
        id: String(ids[i] ?? `${times[i]}-${i}`),
        time: Number(times[i]) || 0,
        line,
        labels: lab,
        level: normaliseLevel(lab, line),
      });
    }
  }
  return out.sort((a, b) => b.time - a.time);
}

/**
 * Distinct values for a label, derived from a recent sample.
 *
 * Loki's own label API isn't reachable through the datasource resource route,
 * so this samples lines and collects what it sees. Good enough to populate a
 * filter dropdown; it will miss a service that has logged nothing recently.
 */
export async function discoverLabelValues(label: string, range = "1h"): Promise<string[]> {
  const lines = await searchLogs({ selector: `{job="docker"}`, range, limit: 1000 })
    .catch(() => [] as LogLine[]);
  return [...new Set(lines.map((l) => l.labels[label]).filter(Boolean) as string[])].sort();
}

export async function isConfigured(): Promise<boolean> {
  try {
    const r = await authFetch("/grafana/api/datasources");
    if (!r.ok) return false;
    const all = await r.json();
    return (Array.isArray(all) ? all : []).some((d: { type?: string }) => d.type === "loki");
  } catch {
    return false;
  }
}
