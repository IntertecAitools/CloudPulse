import { byLabel, joinKey, promQuery, promQueryAll, scalar, selector, type Sample } from "@/lib/prometheus";
import type { ClusterRef, ClusterSummary, NodeRow, PodRow, WorkloadRow } from "./types";

/**
 * Kubernetes views backed by kube-state-metrics and cAdvisor in Prometheus.
 * This is the richer of the two sources — it has pod phase, node conditions
 * and workload replica counts, none of which CloudWatch publishes.
 */

export async function listClusters(): Promise<string[]> {
  const s = await promQuery("count(kube_node_info) by (cluster)").catch(() => [] as Sample[]);
  return [...new Set(s.map((x) => x.metric["cluster"] ?? "").filter(Boolean))].sort();
}

export async function listNamespaces(c: ClusterRef): Promise<string[]> {
  const sel = selector({ cluster: c.name });
  const s = await promQuery(`count(kube_namespace_created${sel}) by (namespace)`).catch(() => [] as Sample[]);
  return [...new Set(s.map((x) => x.metric["namespace"] ?? "").filter(Boolean))].sort();
}

export async function getClusterSummary(c: ClusterRef, namespace: string): Promise<ClusterSummary> {
  const cluster = c.name;
  // Node figures ignore the namespace filter — a node isn't scoped to one.
  const nodeSel = selector({ cluster });
  const podSel = selector({ cluster, namespace });

  const r = await promQueryAll({
    nodesTotal: `count(kube_node_info${nodeSel})`,
    nodesReady: `count(kube_node_status_condition${selector({ cluster, condition: "Ready", status: "true" })} == 1)`,
    phases: `sum(kube_pod_status_phase${podSel}) by (phase)`,
    cpuAllocatable: `sum(kube_node_status_allocatable${selector({ cluster, resource: "cpu" })})`,
    cpuRequested: `sum(kube_pod_container_resource_requests${selector({ cluster, namespace, resource: "cpu" })})`,
    memAllocatable: `sum(kube_node_status_allocatable${selector({ cluster, resource: "memory" })})`,
    memUsed: `sum(container_memory_working_set_bytes${podSel})`,
    restarts: `sum(kube_pod_container_status_restarts_total${podSel})`,
    degradedDeploy: `count(kube_deployment_status_replicas${podSel} - kube_deployment_status_replicas_available${podSel} > 0)`,
    degradedDaemon: `count(kube_daemonset_status_desired_number_scheduled${podSel} - kube_daemonset_status_number_ready${podSel} > 0)`,
    degradedStateful: `count(kube_statefulset_status_replicas${podSel} - kube_statefulset_status_replicas_ready${podSel} > 0)`,
  });

  const podsByPhase: Record<string, number> = {};
  for (const s of r["phases"] ?? []) {
    const phase = s.metric["phase"];
    if (phase) podsByPhase[phase] = (podsByPhase[phase] ?? 0) + s.value;
  }

  const cpuAllocatable = scalar(r["cpuAllocatable"] ?? []);
  const cpuRequested = scalar(r["cpuRequested"] ?? []);
  const memAllocatable = scalar(r["memAllocatable"] ?? []);
  const memUsed = scalar(r["memUsed"] ?? []);

  return {
    nodesTotal: scalar(r["nodesTotal"] ?? []) ?? 0,
    nodesReady: scalar(r["nodesReady"] ?? []) ?? 0,
    podsByPhase,
    cpuAllocatable,
    cpuRequested,
    cpuPercent: cpuAllocatable && cpuRequested != null ? (cpuRequested / cpuAllocatable) * 100 : null,
    memAllocatable,
    memUsed,
    memPercent: memAllocatable && memUsed != null ? (memUsed / memAllocatable) * 100 : null,
    restarts: scalar(r["restarts"] ?? []),
    degradedWorkloads:
      (scalar(r["degradedDeploy"] ?? []) ?? 0) +
      (scalar(r["degradedDaemon"] ?? []) ?? 0) +
      (scalar(r["degradedStateful"] ?? []) ?? 0),
  };
}

export async function getNodes(c: ClusterRef): Promise<NodeRow[]> {
  const cluster = c.name;
  const sel = selector({ cluster });
  const r = await promQueryAll({
    info: `kube_node_info${sel}`,
    ready: `kube_node_status_condition${selector({ cluster, condition: "Ready", status: "true" })}`,
    pressure: `kube_node_status_condition${selector({ cluster, status: "true" })} == 1`,
    cpu: `kube_node_status_capacity${selector({ cluster, resource: "cpu" })}`,
    mem: `kube_node_status_capacity${selector({ cluster, resource: "memory" })}`,
    pods: `count(kube_pod_info${sel}) by (node)`,
    // Pod memory carries no node label, so join it through kube_pod_info.
    memUsed:
      `sum(container_memory_working_set_bytes${sel} * on(pod,namespace) group_left(node) kube_pod_info${sel}) by (node)`,
  });

  const ready = byLabel(r["ready"] ?? [], "node");
  const cpu = byLabel(r["cpu"] ?? [], "node");
  const mem = byLabel(r["mem"] ?? [], "node");
  const pods = byLabel(r["pods"] ?? [], "node");
  const memUsed = byLabel(r["memUsed"] ?? [], "node");

  const pressureByNode = new Map<string, string[]>();
  for (const s of r["pressure"] ?? []) {
    const node = s.metric["node"] ?? "";
    const cond = s.metric["condition"] ?? "";
    if (!node || !cond || cond === "Ready") continue;
    pressureByNode.set(node, [...(pressureByNode.get(node) ?? []), cond]);
  }

  return (r["info"] ?? [])
    .map((s) => {
      const name = s.metric["node"] ?? "";
      const capacity = mem.get(joinKey(name))?.value ?? null;
      const used = memUsed.get(joinKey(name))?.value ?? null;
      return {
        name,
        ready: (ready.get(joinKey(name))?.value ?? 0) === 1,
        pressure: pressureByNode.get(name) ?? [],
        cpuCapacity: cpu.get(joinKey(name))?.value ?? null,
        cpuPercent: null,
        memCapacity: capacity,
        memUsed: used,
        memPercent: capacity && used != null ? (used / capacity) * 100 : null,
        diskPercent: null,
        pods: pods.get(joinKey(name))?.value ?? 0,
        kubelet: s.metric["kubelet_version"] ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getWorkloads(c: ClusterRef, namespace: string): Promise<WorkloadRow[]> {
  const sel = selector({ cluster: c.name, namespace });
  const r = await promQueryAll({
    deployDesired: `kube_deployment_status_replicas${sel}`,
    deployReady: `kube_deployment_status_replicas_available${sel}`,
    stsDesired: `kube_statefulset_status_replicas${sel}`,
    stsReady: `kube_statefulset_status_replicas_ready${sel}`,
    dsDesired: `kube_daemonset_status_desired_number_scheduled${sel}`,
    dsReady: `kube_daemonset_status_number_ready${sel}`,
  });

  const collect = (
    kind: string, nameLabel: string, desired: Sample[], ready: Sample[],
  ): WorkloadRow[] => {
    const readyBy = byLabel(ready, "namespace", nameLabel);
    return desired.map((s) => {
      const ns = s.metric["namespace"] ?? "";
      const name = s.metric[nameLabel] ?? "";
      return {
        kind, namespace: ns, name,
        desired: s.value,
        ready: readyBy.get(joinKey(ns, name))?.value ?? 0,
      };
    });
  };

  return [
    ...collect("Deployment", "deployment", r["deployDesired"] ?? [], r["deployReady"] ?? []),
    ...collect("StatefulSet", "statefulset", r["stsDesired"] ?? [], r["stsReady"] ?? []),
    ...collect("DaemonSet", "daemonset", r["dsDesired"] ?? [], r["dsReady"] ?? []),
  ].sort((a, b) => (a.namespace + a.name).localeCompare(b.namespace + b.name));
}

export async function getPods(c: ClusterRef, namespace: string): Promise<PodRow[]> {
  const sel = selector({ cluster: c.name, namespace });
  const r = await promQueryAll({
    info: `kube_pod_info${sel}`,
    phase: `kube_pod_status_phase${sel} == 1`,
    restarts: `sum(kube_pod_container_status_restarts_total${sel}) by (namespace,pod)`,
    memory: `sum(container_memory_working_set_bytes${sel}) by (namespace,pod)`,
    waiting: `kube_pod_container_status_waiting_reason${sel} == 1`,
  });

  const phase = byLabel(r["phase"] ?? [], "namespace", "pod");
  const restarts = byLabel(r["restarts"] ?? [], "namespace", "pod");
  const memory = byLabel(r["memory"] ?? [], "namespace", "pod");
  const waiting = byLabel(r["waiting"] ?? [], "namespace", "pod");

  return (r["info"] ?? [])
    .map((s) => {
      const ns = s.metric["namespace"] ?? "";
      const name = s.metric["pod"] ?? "";
      const key = joinKey(ns, name);
      return {
        namespace: ns,
        name,
        node: s.metric["node"] ?? "",
        phase: phase.get(key)?.metric["phase"] ?? "Unknown",
        restarts: restarts.get(key)?.value ?? 0,
        memory: memory.get(key)?.value ?? null,
        memPercent: null,
        cpuPercent: null,
        waitingReason: waiting.get(key)?.metric["reason"] ?? "",
        owner: s.metric["created_by_name"] ?? "",
      };
    })
    .sort((a, b) => (a.namespace + a.name).localeCompare(b.namespace + b.name));
}
