import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useRequireAuth } from "@/lib/auth";
import { formatValue } from "@/hooks/use-metric";
import { STATUS_CRITICAL, STATUS_OK, STATUS_WARNING } from "@/lib/chart-theme";
import { discovery, listAccounts, type Account } from "@/lib/grafana-api";
import { getProvider } from "@/lib/providers";
import {
  capabilitiesOf, getClusterSummary, getNodes, getPods, getWorkloads, listClusters, listNamespaces,
  type ClusterRef, type ClusterSummary, type NodeRow, type PodRow, type WorkloadRow,
} from "@/lib/kubernetes";

export const Route = createFileRoute("/kubernetes")({
  head: () => ({ meta: [{ title: "Kubernetes - CloudPulse" }] }),
  component: Kubernetes,
});

const TABS = ["Nodes", "Workloads", "Pods"] as const;
const pct = (v: number | null) => (v == null ? "-" : `${Math.round(v)}%`);

function Kubernetes() {
  useRequireAuth();
  const [awsAccounts, setAwsAccounts] = useState<Account[]>([]);
  const [awsUid, setAwsUid] = useState("");
  const [regions, setRegions] = useState<string[]>([]);
  const [region, setRegion] = useState("");
  const [clusters, setClusters] = useState<ClusterRef[]>([]);
  const [clusterName, setClusterName] = useState("");
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState("");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Nodes");
  const [summary, setSummary] = useState<ClusterSummary | null>(null);
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadRow[]>([]);
  const [pods, setPods] = useState<PodRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const awsAccount = awsAccounts.find((a) => a.uid === awsUid);
  const cluster = clusters.find((c) => c.name === clusterName);
  const caps = capabilitiesOf(cluster);

  // EKS clusters are found through CloudWatch, which is per-region.
  useEffect(() => {
    listAccounts("aws").then((a) => {
      setAwsAccounts(a);
      if (a.length && a[0]) setAwsUid(a[0].uid);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!awsAccount) return;
    setRegion(getProvider("aws").defaultScope(awsAccount));
    discovery.scopes(awsAccount).then(setRegions).catch(() => setRegions([]));
  }, [awsAccount?.uid]);

  useEffect(() => {
    listClusters(awsAccount, region).then((c) => {
      setClusters(c);
      setClusterName((cur) => (c.some((x) => x.name === cur) ? cur : (c[0]?.name ?? "")));
      if (c.length === 0) setLoading(false);
    }).catch(() => setLoading(false));
  }, [awsAccount?.uid, region]);

  useEffect(() => {
    if (!cluster) return;
    setNamespace("");
    listNamespaces(cluster).then(setNamespaces).catch(() => setNamespaces([]));
  }, [cluster?.name, cluster?.source]);

  const load = useCallback(async () => {
    if (!cluster) return;
    setError(null);
    try {
      const [s, n, w, p] = await Promise.all([
        getClusterSummary(cluster, namespace),
        getNodes(cluster),
        getWorkloads(cluster, namespace),
        getPods(cluster, namespace),
      ]);
      setSummary(s); setNodes(n); setWorkloads(w); setPods(p);
      setUpdatedAt(new Date());
    } catch (e) {
      setError((e as Error).message || "Failed to load cluster data");
    }
    setLoading(false);
  }, [cluster?.name, cluster?.source, namespace]);

  useEffect(() => {
    setLoading(true);
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const match = (s: string) => s.toLowerCase().includes(search.toLowerCase());
  const visibleNodes = useMemo(() => nodes.filter((n) => match(n.name)), [nodes, search]);
  const visibleWorkloads = useMemo(
    () => workloads.filter((w) => match(w.name) || match(w.namespace)), [workloads, search]);
  const visiblePods = useMemo(
    () => pods.filter((p) => match(p.name) || match(p.namespace) || match(p.node)), [pods, search]);

  // Deliberately not an early return: the region selector has to stay on
  // screen when nothing is found, or there's no way to look in the region
  // where the cluster actually lives.
  const noClusters = !loading && clusters.length === 0;
  const running = summary?.podsByPhase["Running"] ?? 0;
  const totalPods = Object.values(summary?.podsByPhase ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {awsAccounts.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Region
            <select value={region} onChange={(e) => setRegion(e.target.value)}
              className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Cluster
          <select value={clusterName} onChange={(e) => setClusterName(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            {clusters.length === 0 && <option value="">none found</option>}
            {clusters.map((c) => <option key={`${c.source}-${c.name}`} value={c.name}>{c.name}</option>)}
          </select>
        </label>
        {cluster && (
          <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">
            {cluster.source === "cloudwatch" ? "CloudWatch Container Insights" : "Prometheus"}
          </span>
        )}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Namespace
          <select value={namespace} onChange={(e) => setNamespace(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            <option value="">All namespaces</option>
            {namespaces.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..."
          className="rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground" />
        <span className="ml-auto text-[11px] text-muted-foreground">
          {updatedAt ? `updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">{error}</div>
      )}

      {noClusters && <EmptyState hasAws={awsAccounts.length > 0} region={region} />}

      {!noClusters && (
      <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Tile label="Nodes ready" value={`${summary?.nodesReady ?? 0}/${summary?.nodesTotal ?? 0}`}
          tone={(summary?.nodesReady ?? 0) < (summary?.nodesTotal ?? 0) ? "bad" : "good"} />
        <Tile label={caps.podPhase ? "Pods running" : "Pods"}
          value={caps.podPhase ? `${running}/${totalPods}` : String(running)}
          tone={caps.podPhase && totalPods - running > 0 ? "warn" : "good"} />
        <Tile label={caps.workloadReplicas ? "CPU requested" : "CPU used"}
          value={pct(summary?.cpuPercent ?? null)}
          sub={summary?.cpuAllocatable
            ? `${(summary.cpuRequested ?? 0).toFixed(2)} / ${summary.cpuAllocatable.toFixed(0)} cores` : ""} />
        <Tile label="Memory used" value={pct(summary?.memPercent ?? null)}
          sub={summary?.memUsed != null ? formatValue(summary.memUsed, "bytes") : ""} />
        <Tile label="Restarts" value={String(summary?.restarts ?? 0)}
          tone={(summary?.restarts ?? 0) > 10 ? "warn" : "good"} />
        <Tile label={caps.workloadReplicas ? "Degraded workloads" : "Failed nodes"}
          value={String(summary?.degradedWorkloads ?? 0)}
          tone={(summary?.degradedWorkloads ?? 0) > 0 ? "bad" : "good"} />
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === t ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground"
            }`}>
            {t}
            <span className="ml-2 text-[11px] opacity-60">
              {t === "Nodes" ? nodes.length : t === "Workloads" ? workloads.length : pods.length}
            </span>
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {tab === "Nodes" && <NodesTable rows={visibleNodes} loading={loading} caps={caps} />}
        {tab === "Workloads" && <WorkloadsTable rows={visibleWorkloads} loading={loading} caps={caps} />}
        {tab === "Pods" && <PodsTable rows={visiblePods} loading={loading} caps={caps} />}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Auto-refreshes every 30s.{" "}
        {cluster?.source === "cloudwatch"
          ? "Reads CloudWatch Container Insights. Pod phase, node placement and replica counts aren't published by Container Insights, so those columns are unavailable for this cluster."
          : "Reads kube-state-metrics and cAdvisor series from Prometheus."}
      </p>
      </>
      )}
    </div>
  );
}

function EmptyState({ hasAws, region }: { hasAws: boolean; region: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-12 text-center">
      <p className="text-sm text-foreground">No Kubernetes cluster is reporting metrics.</p>
      <div className="mx-auto mt-3 max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>CloudPulse reads clusters from either of two sources:</p>
        <p>
          <span className="text-foreground">EKS, no cluster access needed</span> — enable the{" "}
          <code className="rounded bg-black/30 px-1">amazon-cloudwatch-observability</code> add-on on the
          cluster (EKS console → Add-ons). Metrics then flow into CloudWatch Container Insights and appear here.
          {hasAws
            ? ` Currently looking in ${region || "the account's default region"} — switch regions above if your cluster is elsewhere.`
            : " Connect an AWS account in Settings first."}
        </p>
        <p>
          <span className="text-foreground">Any cluster</span> — deploy kube-state-metrics and have an
          in-cluster Prometheus agent remote-write here. Richer data, including pod phase and replica counts.
          See <code className="rounded bg-black/30 px-1">deploy/kubernetes/README.md</code>.
        </p>
      </div>
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

function Empty({ loading, what }: { loading: boolean; what: string }) {
  return (
    <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">
      {loading ? "Loading..." : `No ${what} match your filters.`}
    </td></tr>
  );
}

function Bar({ percent }: { percent: number }) {
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded bg-background align-middle">
      <span className="block h-full rounded" style={{
        width: `${Math.min(100, percent)}%`,
        background: percent > 85 ? STATUS_CRITICAL : percent > 60 ? STATUS_WARNING : STATUS_OK,
      }} />
    </span>
  );
}

type Caps = ReturnType<typeof capabilitiesOf>;

function NodesTable({ rows, loading, caps }: { rows: NodeRow[]; loading: boolean; caps: Caps }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th className={TH}>Node</th>
          {caps.nodeConditions && <th className={TH}>Status</th>}
          <th className={TH}>CPU</th><th className={TH}>Memory</th>
          {!caps.absoluteMemory && <th className={TH}>Disk</th>}
          <th className={TH}>Pods</th>
          {caps.nodeConditions && <th className={TH}>Kubelet</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((n) => (
          <tr key={n.name} className="border-b border-border last:border-0">
            <td className={`${TD} font-mono text-xs`}>{n.name}</td>
            {caps.nodeConditions && (
              <td className="px-4 py-3">
                {n.ready
                  ? <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">Ready</span>
                  : <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">Not Ready</span>}
                {n.pressure.map((p) => (
                  <span key={p} className="ml-1 rounded bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-400">{p}</span>
                ))}
              </td>
            )}
            <td className={TD}>
              {n.cpuPercent != null
                ? <span className="flex items-center gap-2"><Bar percent={n.cpuPercent} /><span className="text-xs">{pct(n.cpuPercent)}</span></span>
                : n.cpuCapacity != null ? `${n.cpuCapacity} cores` : "-"}
            </td>
            <td className={TD}>
              {n.memCapacity && n.memPercent != null ? (
                <span className="flex items-center gap-2">
                  <Bar percent={n.memPercent} />
                  <span className="text-xs">
                    {n.memUsed != null ? formatValue(n.memUsed, "bytes") : "-"} / {formatValue(n.memCapacity, "bytes")}
                  </span>
                </span>
              ) : n.memPercent != null ? (
                <span className="flex items-center gap-2"><Bar percent={n.memPercent} /><span className="text-xs">{pct(n.memPercent)}</span></span>
              ) : "-"}
            </td>
            {!caps.absoluteMemory && (
              <td className={TD}>
                {n.diskPercent != null
                  ? <span className="flex items-center gap-2"><Bar percent={n.diskPercent} /><span className="text-xs">{pct(n.diskPercent)}</span></span>
                  : "-"}
              </td>
            )}
            <td className={TD}>{n.pods ?? "-"}</td>
            {caps.nodeConditions && <td className="px-4 py-3 text-xs text-muted-foreground">{n.kubelet || "-"}</td>}
          </tr>
        ))}
        {rows.length === 0 && <Empty loading={loading} what="nodes" />}
      </tbody>
    </table>
  );
}

function WorkloadsTable({ rows, loading, caps }: { rows: WorkloadRow[]; loading: boolean; caps: Caps }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th className={TH}>Kind</th><th className={TH}>Namespace</th><th className={TH}>Name</th>
          <th className={TH}>{caps.workloadReplicas ? "Ready" : "Running pods"}</th>
          {caps.workloadReplicas && <th className={TH}>Status</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((w) => {
          const healthy = w.desired == null || w.ready >= w.desired;
          return (
            <tr key={`${w.kind}-${w.namespace}-${w.name}`} className="border-b border-border last:border-0">
              <td className="px-4 py-3 text-xs text-muted-foreground">{w.kind}</td>
              <td className={`${TD} text-xs`}>{w.namespace}</td>
              <td className={`${TD} font-mono text-xs`}>{w.name}</td>
              <td className={TD}>{w.desired == null ? w.ready : `${w.ready}/${w.desired}`}</td>
              {caps.workloadReplicas && (
                <td className="px-4 py-3">
                  {healthy
                    ? <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400">Available</span>
                    : <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">Degraded</span>}
                </td>
              )}
            </tr>
          );
        })}
        {rows.length === 0 && <Empty loading={loading} what="workloads" />}
      </tbody>
    </table>
  );
}

const PHASE_STYLE: Record<string, string> = {
  Running: "bg-emerald-500/15 text-emerald-400",
  Pending: "bg-yellow-500/15 text-yellow-400",
  Failed: "bg-red-500/15 text-red-400",
  Succeeded: "bg-white/5 text-muted-foreground",
};

function PodsTable({ rows, loading, caps }: { rows: PodRow[]; loading: boolean; caps: Caps }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-xs text-muted-foreground">
          <th className={TH}>Namespace</th><th className={TH}>Pod</th>
          {caps.podNode && <th className={TH}>Node</th>}
          {caps.podPhase && <th className={TH}>Phase</th>}
          {!caps.absoluteMemory && <th className={TH}>CPU</th>}
          <th className={TH}>Restarts</th><th className={TH}>Memory</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={`${p.namespace}-${p.name}`} className="border-b border-border last:border-0">
            <td className={`${TD} text-xs`}>{p.namespace}</td>
            <td className={`${TD} font-mono text-xs`}>
              {p.name}
              {p.waitingReason && (
                <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-400">{p.waitingReason}</span>
              )}
            </td>
            {caps.podNode && <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{p.node}</td>}
            {caps.podPhase && (
              <td className="px-4 py-3">
                <span className={`rounded px-2 py-0.5 text-xs ${PHASE_STYLE[p.phase] ?? "bg-white/5 text-muted-foreground"}`}>
                  {p.phase}
                </span>
              </td>
            )}
            {!caps.absoluteMemory && <td className={TD}>{pct(p.cpuPercent)}</td>}
            <td className={TD} style={p.restarts > 5 ? { color: STATUS_CRITICAL } : undefined}>{p.restarts}</td>
            <td className={TD}>
              {p.memory != null ? formatValue(p.memory, "bytes") : pct(p.memPercent)}
            </td>
          </tr>
        ))}
        {rows.length === 0 && <Empty loading={loading} what="pods" />}
      </tbody>
    </table>
  );
}
