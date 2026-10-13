import { useCallback, useEffect, useRef, useState } from "react";
import type { Panel } from "@/config/panels";
import { authFetch } from "@/lib/auth";
import { SERIES_PALETTE as PALETTE } from "@/lib/chart-theme";
import { providerForAccount, type Account } from "@/lib/providers";
import type { TimeRangeValue } from "@/lib/time-range";

export type MetricRow = Record<string, number> & { time: number };
export type SeriesInfo = { key: string; color?: string };

/**
 * Short series label for a resource handle. Azure hands back a full ARM URI,
 * where the last segment is the resource name; AWS hands back an instance id,
 * where the tail is the distinguishing part.
 */
function shortResource(id: string): string {
  return id.includes("/") ? (id.split("/").pop() ?? id) : id.slice(-8);
}

export function useMetric(
  panel: Panel,
  range: TimeRangeValue,
  account: Account | undefined,
  resourceIds: string[],
  scope: string,
) {
  const [data, setData] = useState<MetricRow[]>([]);
  const [series, setSeries] = useState<SeriesInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    if (!account) {
      setLoading(false);
      return;
    }
    const provider = providerForAccount(account);
    const resourceScoped = provider.isResourceScoped(panel);
    if (resourceScoped && resourceIds.length === 0) {
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);

    // Resource-scoped panels fan out to one query per (series x resource).
    // Panels with their own dimensions issue a single query per series.
    type Q = { refId: string; label: string; color?: string; body: Record<string, unknown> };
    const qs: Q[] = [];
    const multi = resourceScoped && resourceIds.length > 1;

    panel.series.forEach((s) => {
      const targets = resourceScoped ? resourceIds : [""];
      targets.forEach((resourceId) => {
        const refId = `q${qs.length}`;
        const short = resourceId ? shortResource(resourceId) : "";
        const label = multi ? (panel.series.length > 1 ? `${s.label} ${short}` : short) : s.label;
        const color = multi ? PALETTE[qs.length % PALETTE.length] : s.color;
        qs.push({
          refId,
          label,
          ...(color ? { color } : {}),
          body: provider.buildQuery({
            refId,
            dsUid: account.uid,
            scope,
            namespace: panel.namespace,
            metricName: s.metricName,
            statistic: panel.statistic,
            period: panel.period,
            ...(resourceId ? { resourceId } : {}),
            ...(panel.dimensions ? { dimensions: panel.dimensions } : {}),
          }),
        });
      });
    });

    try {
      const res = await authFetch("/grafana/api/ds/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: `now-${range}`, to: "now", queries: qs.map((q) => q.body) }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Query failed (${res.status})`);
      const json = await res.json();

      const merged = new Map<number, MetricRow>();
      qs.forEach((q) => {
        const frames = json?.results?.[q.refId]?.frames ?? [];
        for (const frame of frames) {
          const [ts, vals] = frame?.data?.values ?? [[], []];
          ts.forEach((t: number, idx: number) => {
            const row = merged.get(t) ?? ({ time: t } as MetricRow);
            if (vals[idx] != null) row[q.label] = vals[idx];
            merged.set(t, row);
          });
        }
      });
      setData([...merged.values()].sort((a, b) => a.time - b.time));
      setSeries(qs.map((q) => ({ key: q.label, ...(q.color ? { color: q.color } : {}) })));
      setLoading(false);
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message || "Failed to load");
      setLoading(false);
    }
  }, [panel, range, account, resourceIds, scope]);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, 60_000);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [fetchData]);

  return { data, series, loading, error, retry: fetchData };
}

export function formatValue(v: number, unit: "percent" | "bytes" | "count") {
  if (unit === "percent") return `${v.toFixed(1)}%`;
  if (unit === "bytes") {
    if (v >= 1073741824) return `${(v / 1073741824).toFixed(1)} GB`;
    if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
    if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${v.toFixed(0)} B`;
  }
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;
}
