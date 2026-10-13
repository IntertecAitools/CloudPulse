import { authFetch } from "@/lib/auth";
import type {
  ClusterRef, ClusterSummary, NodeRow, PodRow, WorkloadRow,
} from "./types";

/**
 * Kubernetes views backed by CloudWatch Container Insights.
 *
 * Used for EKS clusters when CloudPulse can't reach the cluster's API but does
 * have AWS credentials — Container Insights publishes cluster/node/pod metrics
 * into the `ContainerInsights` namespace, so no in-cluster agent of ours is
 * needed. Requires the `amazon-cloudwatch-observability` EKS add-on.
 *
 * Every table uses a CloudWatch SEARCH expression, which returns one series per
 * entity from a single query — otherwise each node and pod would need its own
 * request. Grafana puts the entity identifier in the frame's schema name.
 */

const NS = "ContainerInsights";

/**
 * A CloudWatch SEARCH expression matches an *exact* dimension set, so these
 * have to mirror what Container Insights actually publishes — verified against
 * a live cluster. Node metrics carry InstanceId as well as NodeName; asking
 * for {ClusterName,NodeName} alone silently matches nothing.
 */
const NODE_DIMS = ["ClusterName", "InstanceId", "NodeName"];
const POD_DIMS = ["ClusterName", "Namespace", "PodName"];
const NAMESPACE_DIMS = ["ClusterName", "Namespace"];
const SERVICE_DIMS = ["ClusterName", "Namespace", "Service"];

type Frame = {
  schema?: { name?: string; fields?: { labels?: Record<string, string> }[] };
  data?: { values?: unknown[][] };
};

/** Latest non-null value of a frame, with the entity name Grafana assigned. */
function latest(frame: Frame): { name: string; value: number } | null {
  const name = frame.schema?.name ?? "";
  const vals = (frame.data?.values?.[1] ?? []) as (number | null)[];
  for (let i = vals.length - 1; i >= 0; i--) {
    const v = vals[i];
    if (v != null && !Number.isNaN(v)) return { name, value: Number(v) };
  }
  return null;
}

function searchQuery(refId: string, dsUid: string, region: string, dims: string[], metric: string, filters: string) {
  const expr = `SEARCH('{${NS},${dims.join(",")}} MetricName="${metric}"${filters}', 'Average', 300)`;
  return {
    refId,
    id: refId,
    datasource: { type: "cloudwatch", uid: dsUid },
    queryMode: "Metrics",
    metricQueryType: 0,
    // Code mode — required for SEARCH expressions. The builder fields below
    // must still be present or the plugin rejects the query outright.
    metricEditorMode: 1,
    namespace: NS,
    metricName: metric,
    dimensions: {},
    statistic: "Average",
    period: "300",
    matchExact: false,
    expression: expr,
    region,
  };
}

/** Runs several SEARCH expressions in one ds/query round trip. */
async function runSearches(
  dsUid: string, region: string,
  specs: { key: string; dims: string[]; metric: string; filters?: string }[],
): Promise<Record<string, { name: string; value: number }[]>> {
  const queries = specs.map((s, i) =>
    searchQuery(`q${i}`, dsUid, region, s.dims, s.metric, s.filters ?? ""));

  const r = await authFetch("/grafana/api/ds/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from: "now-1h", to: "now", queries }),
  });
  if (!r.ok) throw new Error(`CloudWatch query failed (${r.status})`);
  const json = await r.json();

  const out: Record<string, { name: string; value: number }[]> = {};
  specs.forEach((s, i) => {
    const frames: Frame[] = json?.results?.[`q${i}`]?.frames ?? [];
    out[s.key] = frames.map(latest).filter((x): x is { name: string; value: number } => x !== null);
  });
  return out;
}

/** CloudWatch escapes nothing for us; keep cluster names out of the expression grammar. */
const safe = (v: string) => v.replace(/["'\\]/g, "");

/** SEARCH series names are space-joined dimension values in schema order. */
function tail(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

export async function listClusters(dsUid: string, region: string): Promise<string[]> {
  const r = await authFetch(
    `/grafana/api/datasources/uid/${dsUid}/resources/dimension-values` +
      `?region=${encodeURIComponent(region)}&namespace=${encodeURIComponent(NS)}` +
      `&dimensionKey=ClusterName&metricName=cluster_node_count`,
  );
  if (!r.ok) return [];
  const json = await r.json();
  const names = (Array.isArray(json) ? json : [])
    .map((x: unknown) => {
      if (typeof x === "string") return x;
      const o = x as Record<string, unknown>;
      return typeof o?.["value"] === "string" ? (o["value"] as string) : "";
    })
    .filter(Boolean);
  return [...new Set(names)].sort();
}

export async function listNamespaces(c: ClusterRef): Promise<string[]> {
  if (!c.accountUid || !c.region) return [];
  const r = await runSearches(c.accountUid, c.region, [{
    key: "ns", dims: NAMESPACE_DIMS,
    metric: "namespace_number_of_running_pods", filters: ` ClusterName="${safe(c.name)}"`,
  }]);
  return [...new Set((r["ns"] ?? []).map((x) => tail(x.name)))].filter(Boolean).sort();
}

export async function getClusterSummary(c: ClusterRef): Promise<ClusterSummary> {
  if (!c.accountUid || !c.region) throw new Error("Cluster is missing its AWS account");
  const f = ` ClusterName="${safe(c.name)}"`;
  const r = await runSearches(c.accountUid, c.region, [
    { key: "nodes", dims: ["ClusterName"], metric: "cluster_node_count", filters: f },
    { key: "failed", dims: ["ClusterName"], metric: "cluster_failed_node_count", filters: f },
    { key: "pods", dims: NAMESPACE_DIMS, metric: "namespace_number_of_running_pods", filters: f },
    { key: "cpu", dims: NODE_DIMS, metric: "node_cpu_utilization", filters: f },
    { key: "mem", dims: NODE_DIMS, metric: "node_memory_utilization", filters: f },
    { key: "restarts", dims: POD_DIMS, metric: "pod_number_of_container_restarts", filters: f },
  ]);

  const sum = (k: string) => (r[k] ?? []).reduce((a, b) => a + b.value, 0);
  const avg = (k: string) => {
    const xs = r[k] ?? [];
    return xs.length ? xs.reduce((a, b) => a + b.value, 0) / xs.length : null;
  };
  const nodes = r["nodes"]?.[0]?.value ?? 0;
  const failed = r["failed"]?.[0]?.value ?? 0;
  const running = sum("pods");

  return {
    nodesTotal: nodes,
    nodesReady: Math.max(0, nodes - failed),
    podsByPhase: { Running: running },
    cpuAllocatable: null,
    cpuRequested: null,
    cpuPercent: avg("cpu"),
    memAllocatable: null,
    memUsed: null,
    memPercent: avg("mem"),
    restarts: sum("restarts"),
    degradedWorkloads: failed,
  };
}

export async function getNodes(c: ClusterRef): Promise<NodeRow[]> {
  if (!c.accountUid || !c.region) return [];
  const f = ` ClusterName="${safe(c.name)}"`;
  const d = NODE_DIMS;
  const r = await runSearches(c.accountUid, c.region, [
    { key: "cpu", dims: d, metric: "node_cpu_utilization", filters: f },
    { key: "mem", dims: d, metric: "node_memory_utilization", filters: f },
    { key: "disk", dims: d, metric: "node_filesystem_utilization", filters: f },
    { key: "pods", dims: d, metric: "node_number_of_running_pods", filters: f },
  ]);

  const index = (k: string) => new Map((r[k] ?? []).map((x) => [tail(x.name), x.value]));
  const cpu = index("cpu"), mem = index("mem"), disk = index("disk"), pods = index("pods");
  const names = [...new Set([...cpu.keys(), ...mem.keys(), ...disk.keys(), ...pods.keys()])];

  return names.sort().map((name) => ({
    name,
    // Container Insights has no node condition metric; a node reporting
    // utilisation at all is the best "up" signal available here.
    ready: true,
    pressure: [],
    cpuCapacity: null,
    cpuPercent: cpu.get(name) ?? null,
    memCapacity: null,
    memUsed: null,
    memPercent: mem.get(name) ?? null,
    diskPercent: disk.get(name) ?? null,
    pods: pods.get(name) ?? null,
    kubelet: "",
  }));
}

export async function getWorkloads(c: ClusterRef, namespace: string): Promise<WorkloadRow[]> {
  if (!c.accountUid || !c.region) return [];
  const f = ` ClusterName="${safe(c.name)}"${namespace ? ` Namespace="${safe(namespace)}"` : ""}`;
  const r = await runSearches(c.accountUid, c.region, [{
    key: "svc", dims: SERVICE_DIMS, metric: "service_number_of_running_pods", filters: f,
  }]);

  // Container Insights reports running pods per service, not desired replicas,
  // so "desired" is unknown and the Status column is suppressed for this source.
  return (r["svc"] ?? []).map((x) => {
    const parts = x.name.trim().split(/\s+/);
    return {
      kind: "Service",
      namespace: parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "",
      name: tail(x.name),
      desired: null,
      ready: x.value,
    };
  }).sort((a, b) => (a.namespace + a.name).localeCompare(b.namespace + b.name));
}

export async function getPods(c: ClusterRef, namespace: string): Promise<PodRow[]> {
  if (!c.accountUid || !c.region) return [];
  const f = ` ClusterName="${safe(c.name)}"${namespace ? ` Namespace="${safe(namespace)}"` : ""}`;
  const d = POD_DIMS;
  const r = await runSearches(c.accountUid, c.region, [
    { key: "cpu", dims: d, metric: "pod_cpu_utilization", filters: f },
    { key: "mem", dims: d, metric: "pod_memory_utilization", filters: f },
    { key: "restarts", dims: d, metric: "pod_number_of_container_restarts", filters: f },
  ]);

  const key = (n: string) => {
    const p = n.trim().split(/\s+/);
    return { ns: p.length >= 2 ? (p[p.length - 2] ?? "") : "", pod: p[p.length - 1] ?? "" };
  };
  const index = (k: string) => {
    const m = new Map<string, { ns: string; pod: string; value: number }>();
    for (const x of r[k] ?? []) {
      const { ns, pod } = key(x.name);
      m.set(`${ns}/${pod}`, { ns, pod, value: x.value });
    }
    return m;
  };
  const cpu = index("cpu"), mem = index("mem"), restarts = index("restarts");
  const all = new Map([...cpu, ...mem, ...restarts]);

  return [...all.values()].map((e) => ({
    namespace: e.ns,
    name: e.pod,
    node: "",
    phase: "",
    restarts: restarts.get(`${e.ns}/${e.pod}`)?.value ?? 0,
    memory: null,
    memPercent: mem.get(`${e.ns}/${e.pod}`)?.value ?? null,
    cpuPercent: cpu.get(`${e.ns}/${e.pod}`)?.value ?? null,
    waitingReason: "",
    owner: "",
  })).sort((a, b) => (a.namespace + a.name).localeCompare(b.namespace + b.name));
}
