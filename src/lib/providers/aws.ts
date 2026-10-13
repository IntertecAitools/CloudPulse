import type { Panel } from "@/config/panels";
import { authFetch } from "@/lib/auth";
import { describeResourceError } from "./error";
import type { Account, CloudProvider, CloudResource, QueryContext } from "./types";

/**
 * Grafana resource APIs return varying shapes across versions: strings,
 * {text, value}, {value: {name, namespace}}, {name, namespace}...
 * Normalize anything into a plain string.
 */
export function toStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    if (typeof o["value"] === "string") return o["value"];
    if (o["value"] && typeof o["value"] === "object") {
      const v = o["value"] as Record<string, unknown>;
      if (typeof v["name"] === "string") return v["name"];
    }
    if (typeof o["text"] === "string") return o["text"];
    if (typeof o["name"] === "string") return o["name"];
  }
  return "";
}

export function toStrList(json: unknown): string[] {
  const arr = Array.isArray(json) ? json : [];
  return [...new Set(arr.map(toStr).filter(Boolean))];
}

/**
 * Discovery call that degrades quietly. Used where a static fallback exists
 * (regions, namespaces) so the panel builder still works without AWS reachable.
 */
async function res(dsUid: string, path: string): Promise<string[]> {
  try {
    const r = await authFetch(`/grafana/api/datasources/uid/${dsUid}/resources/${path}`);
    if (!r.ok) return [];
    return toStrList(await r.json());
  } catch {
    return [];
  }
}

/** Discovery call that reports failure, for lookups with no sensible fallback. */
async function resStrict(dsUid: string, path: string, what: string): Promise<string[]> {
  const r = await authFetch(`/grafana/api/datasources/uid/${dsUid}/resources/${path}`);
  if (!r.ok) throw await describeResourceError(r, what);
  return toStrList(await r.json());
}

export const ALL_REGIONS = [
  "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "af-south-1", "ap-east-1", "ap-south-1", "ap-south-2",
  "ap-southeast-1", "ap-southeast-2", "ap-southeast-3", "ap-southeast-4", "ap-southeast-5",
  "ap-northeast-1", "ap-northeast-2", "ap-northeast-3",
  "ca-central-1", "ca-west-1",
  "eu-central-1", "eu-central-2", "eu-west-1", "eu-west-2", "eu-west-3",
  "eu-north-1", "eu-south-1", "eu-south-2",
  "il-central-1", "me-south-1", "me-central-1", "mx-central-1", "sa-east-1",
];

const FALLBACK_NAMESPACES = [
  "AWS/EC2", "AWS/EBS", "AWS/S3", "AWS/Lambda",
  "AWS/RDS", "AWS/ELB", "AWS/ApplicationELB", "AWS/Billing",
];

const defaultPanels: Panel[] = [
  { title: "CPU Utilization", unit: "percent", namespace: "AWS/EC2", statistic: "Average", period: "300",
    series: [{ label: "CPU %", metricName: "CPUUtilization" }] },
  { title: "Network In / Out", unit: "bytes", namespace: "AWS/EC2", statistic: "Average", period: "300",
    series: [
      { label: "In", metricName: "NetworkIn" },
      { label: "Out", metricName: "NetworkOut", color: "#ffd27f" },
    ] },
  { title: "CPU Credit Balance", unit: "count", namespace: "AWS/EC2", statistic: "Average", period: "300",
    series: [{ label: "Credits", metricName: "CPUCreditBalance", color: "#c39dff" }] },
  { title: "Status Check Failed", unit: "count", namespace: "AWS/EC2", statistic: "Maximum", period: "300",
    series: [{ label: "Failures", metricName: "StatusCheckFailed", color: "#ff8fa3" }] },
];

export const aws: CloudProvider = {
  id: "aws",
  label: "Amazon Web Services",
  short: "AWS",
  color: "#ff9900",
  description: "EC2, EBS, Lambda, RDS and every CloudWatch namespace.",
  datasourceType: "cloudwatch",

  terms: {
    account: "AWS account",
    scope: "Region",
    resource: "Instances",
    namespace: "Namespace",
    statistic: "Statistic",
  },

  statistics: ["Average", "Sum", "Maximum", "Minimum"],
  defaultPeriod: "300",

  accountFields: [
    { key: "accessKey", label: "Access Key ID", placeholder: "AKIA..." },
    { key: "secretKey", label: "Secret Access Key", placeholder: "secret", secret: true },
  ],

  buildDatasource(name, v) {
    return {
      name,
      type: "cloudwatch",
      access: "proxy",
      jsonData: { authType: "keys", defaultRegion: v["region"] || "us-east-1" },
      secureJsonData: { accessKey: v["accessKey"] ?? "", secretKey: v["secretKey"] ?? "" },
    };
  },

  defaultScope(account) {
    return account?.jsonData?.defaultRegion ?? "us-east-1";
  },

  async listScopes(dsUid) {
    const list = (await res(dsUid, "regions")).filter((x) => x !== "default");
    // A short list means the call degraded rather than genuinely returned
    // only a couple of regions; fall back to the static set.
    return list.length > 3 ? list : ALL_REGIONS;
  },

  async listNamespaces(dsUid, scope) {
    const list = await res(dsUid, `namespaces?region=${encodeURIComponent(scope)}`);
    return list.length ? list : FALLBACK_NAMESPACES;
  },

  listMetrics(dsUid, scope, namespace) {
    return resStrict(
      dsUid,
      `metrics?region=${encodeURIComponent(scope)}&namespace=${encodeURIComponent(namespace)}`,
      "Loading metrics",
    );
  },

  async listResources(dsUid, scope): Promise<CloudResource[]> {
    const ids = await resStrict(
      dsUid,
      `dimension-values?region=${encodeURIComponent(scope)}&namespace=AWS/EC2` +
        `&dimensionKey=InstanceId&metricName=CPUUtilization`,
      "Loading instances",
    );
    return ids.map((id) => ({ id, label: id }));
  },

  listDimensionKeys(dsUid, scope, namespace, metricName) {
    return res(
      dsUid,
      `dimension-keys?region=${encodeURIComponent(scope)}&namespace=${encodeURIComponent(namespace)}` +
        `&metricName=${encodeURIComponent(metricName)}`,
    );
  },

  listDimensionValues(dsUid, scope, namespace, metricName, key) {
    return res(
      dsUid,
      `dimension-values?region=${encodeURIComponent(scope)}&namespace=${encodeURIComponent(namespace)}` +
        `&metricName=${encodeURIComponent(metricName)}&dimensionKey=${encodeURIComponent(key)}`,
    );
  },

  /** EC2 panels without explicit dimensions follow the instance picker. */
  isResourceScoped(panel) {
    return !panel.dimensions && panel.namespace === "AWS/EC2";
  },

  buildQuery(ctx: QueryContext) {
    const dimensions = ctx.dimensions
      ? ctx.dimensions
      : ctx.resourceId
        ? { InstanceId: ctx.resourceId }
        : {};
    return {
      refId: ctx.refId,
      datasource: { type: "cloudwatch", uid: ctx.dsUid },
      queryMode: "Metrics",
      metricQueryType: 0,
      metricEditorMode: 0,
      namespace: ctx.namespace,
      metricName: ctx.metricName,
      dimensions,
      statistic: ctx.statistic,
      period: ctx.period,
      region: ctx.scope,
      matchExact: true,
    };
  },

  fleetNamespace: "AWS/EC2",
  fleetMetrics: [
    { key: "cpu", metricName: "CPUUtilization", statistic: "Average" },
    { key: "netIn", metricName: "NetworkIn", statistic: "Average" },
    { key: "netOut", metricName: "NetworkOut", statistic: "Average" },
    { key: "health", metricName: "StatusCheckFailed", statistic: "Maximum" },
  ],

  defaultPanels,
};
