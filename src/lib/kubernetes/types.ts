/** Where a cluster's metrics come from. */
export type ClusterSource = "prometheus" | "cloudwatch";

export type ClusterRef = {
  name: string;
  source: ClusterSource;
  /** CloudWatch only: which account and region to query. */
  accountUid?: string;
  region?: string;
};

export type ClusterSummary = {
  nodesTotal: number;
  nodesReady: number;
  podsByPhase: Record<string, number>;
  /** Prometheus reports cores; CloudWatch reports a percentage. */
  cpuAllocatable: number | null;
  cpuRequested: number | null;
  cpuPercent: number | null;
  memAllocatable: number | null;
  memUsed: number | null;
  memPercent: number | null;
  restarts: number | null;
  degradedWorkloads: number;
};

export type NodeRow = {
  name: string;
  ready: boolean;
  pressure: string[];
  cpuCapacity: number | null;
  cpuPercent: number | null;
  memCapacity: number | null;
  memUsed: number | null;
  memPercent: number | null;
  diskPercent: number | null;
  pods: number | null;
  kubelet: string;
};

export type WorkloadRow = {
  kind: string;
  namespace: string;
  name: string;
  desired: number | null;
  ready: number;
};

export type PodRow = {
  namespace: string;
  name: string;
  node: string;
  phase: string;
  restarts: number;
  memory: number | null;
  memPercent: number | null;
  cpuPercent: number | null;
  waitingReason: string;
  owner: string;
};

/**
 * What a source can actually supply. CloudWatch Container Insights publishes
 * utilisation percentages and counts but no pod phase, node placement or
 * workload replica counts, so the UI hides those columns rather than showing
 * empty ones.
 */
export type SourceCapabilities = {
  podPhase: boolean;
  podNode: boolean;
  nodeConditions: boolean;
  workloadReplicas: boolean;
  absoluteMemory: boolean;
};

export const PROMETHEUS_CAPABILITIES: SourceCapabilities = {
  podPhase: true,
  podNode: true,
  nodeConditions: true,
  workloadReplicas: true,
  absoluteMemory: true,
};

export const CLOUDWATCH_CAPABILITIES: SourceCapabilities = {
  podPhase: false,
  podNode: false,
  nodeConditions: false,
  workloadReplicas: false,
  absoluteMemory: false,
};
