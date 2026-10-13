import type { Account } from "@/lib/providers";
import * as cw from "./cloudwatch";
import * as prom from "./prometheus";
import {
  CLOUDWATCH_CAPABILITIES, PROMETHEUS_CAPABILITIES,
  type ClusterRef, type ClusterSummary, type NodeRow, type PodRow,
  type SourceCapabilities, type WorkloadRow,
} from "./types";

export type {
  ClusterRef, ClusterSource, ClusterSummary, NodeRow, PodRow, SourceCapabilities, WorkloadRow,
} from "./types";

/**
 * Two ways a cluster can reach CloudPulse:
 *
 *   prometheus — kube-state-metrics + cAdvisor, via scrape or remote-write.
 *                Full fidelity: pod phase, node conditions, replica counts.
 *   cloudwatch — EKS with the CloudWatch Container Insights add-on. Needs
 *                nothing deployed by us, but only publishes utilisation and
 *                counts, so some columns are unavailable.
 *
 * Both are listed together; each cluster carries where it came from.
 */

export function capabilitiesOf(c: ClusterRef | undefined): SourceCapabilities {
  return c?.source === "cloudwatch" ? CLOUDWATCH_CAPABILITIES : PROMETHEUS_CAPABILITIES;
}

/**
 * Clusters from every source. `awsAccount`/`region` scope the Container
 * Insights lookup; CloudWatch has no cross-region listing, so callers pick a
 * region the same way Overview and Infrastructure do.
 */
export async function listClusters(
  awsAccount?: Account | undefined,
  region?: string | undefined,
): Promise<ClusterRef[]> {
  const [fromProm, fromCw] = await Promise.all([
    prom.listClusters().catch(() => [] as string[]),
    awsAccount && region
      ? cw.listClusters(awsAccount.uid, region).catch(() => [] as string[])
      : Promise.resolve([] as string[]),
  ]);

  const out: ClusterRef[] = fromProm.map((name) => ({ name, source: "prometheus" as const }));
  for (const name of fromCw) {
    // A cluster reporting through both wins on Prometheus — richer data.
    if (out.some((c) => c.name === name)) continue;
    out.push({
      name,
      source: "cloudwatch",
      ...(awsAccount ? { accountUid: awsAccount.uid } : {}),
      ...(region ? { region } : {}),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function listNamespaces(c: ClusterRef): Promise<string[]> {
  return c.source === "cloudwatch" ? cw.listNamespaces(c) : prom.listNamespaces(c);
}

export function getClusterSummary(c: ClusterRef, namespace: string): Promise<ClusterSummary> {
  return c.source === "cloudwatch" ? cw.getClusterSummary(c) : prom.getClusterSummary(c, namespace);
}

export function getNodes(c: ClusterRef): Promise<NodeRow[]> {
  return c.source === "cloudwatch" ? cw.getNodes(c) : prom.getNodes(c);
}

export function getWorkloads(c: ClusterRef, namespace: string): Promise<WorkloadRow[]> {
  return c.source === "cloudwatch" ? cw.getWorkloads(c, namespace) : prom.getWorkloads(c, namespace);
}

export function getPods(c: ClusterRef, namespace: string): Promise<PodRow[]> {
  return c.source === "cloudwatch" ? cw.getPods(c, namespace) : prom.getPods(c, namespace);
}
