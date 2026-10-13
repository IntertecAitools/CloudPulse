import type { Panel } from "@/config/panels";
import { authFetch } from "@/lib/auth";
import type { Account, CloudProvider, CloudResource, QueryContext } from "./types";

/**
 * Azure Monitor support.
 *
 * Grafana's Azure Monitor plugin exposes a plain ARM passthrough under the
 * datasource resource route `azuremonitor/<arm-path>`, so discovery is just
 * Azure Resource Manager calls. (The `azureresourcegraph/` route that the
 * Grafana UI uses for cross-subscription search is not registered in this
 * build — verified against the running Grafana — so everything here goes
 * through ARM, which is available in every version.)
 *
 * Mapping to the app's AWS-shaped vocabulary:
 *   region     -> resource group   (the useful way to scope Azure resources)
 *   namespace  -> ARM resource type / metric namespace
 *   statistic  -> aggregation
 *   period     -> timeGrain (ISO 8601 duration)
 *   resourceId -> the full ARM resource URI, which carries subscription and
 *                 resource group so buildQuery needs no extra lookup.
 */

export const AZURE_DATASOURCE_TYPE = "grafana-azure-monitor-datasource";
const VM_TYPE = "Microsoft.Compute/virtualMachines";

const FALLBACK_NAMESPACES = [
  VM_TYPE,
  "Microsoft.Storage/storageAccounts",
  "Microsoft.Web/sites",
  "Microsoft.Sql/servers/databases",
  "Microsoft.Network/loadBalancers",
  "Microsoft.Network/applicationGateways",
  "Microsoft.ContainerService/managedClusters",
  "Microsoft.DocumentDB/databaseAccounts",
  "Microsoft.KeyVault/vaults",
];

/** ARM GET through the Grafana datasource proxy. Returns null on any failure. */
async function arm<T>(dsUid: string, path: string): Promise<T | null> {
  try {
    const r = await authFetch(`/grafana/api/datasources/uid/${dsUid}/resources/azuremonitor/${path}`);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

type ArmList<T> = { value?: T[] };
type ArmResource = { id: string; name: string; type: string; location?: string };
type MetricDefinition = {
  name?: { value?: string; localizedValue?: string };
  dimensions?: { value?: string; localizedValue?: string }[];
};

function subscriptionOf(account: Account | undefined): string {
  return account?.jsonData?.subscriptionId ?? "";
}

/** `/subscriptions/S/resourceGroups/G/providers/Microsoft.Compute/virtualMachines/N` */
export function parseResourceUri(uri: string): {
  subscription: string;
  resourceGroup: string;
  resourceName: string;
  metricNamespace: string;
} | null {
  const p = uri.split("/").filter(Boolean);
  const i = p.findIndex((x) => x.toLowerCase() === "providers");
  if (p[0]?.toLowerCase() !== "subscriptions" || i < 4 || p.length < i + 4) return null;
  const subscription = p[1] ?? "";
  const resourceGroup = p[3] ?? "";
  // Everything after "providers" except the trailing name is the type; Azure
  // nests sub-resources (e.g. .../servers/S/databases/D), so take the last
  // segment as the name and fold the rest into the namespace.
  const rest = p.slice(i + 1);
  const resourceName = rest[rest.length - 1] ?? "";
  const typeParts = rest.slice(0, -1);
  const metricNamespace = typeParts.join("/");
  if (!subscription || !resourceGroup || !resourceName || !metricNamespace) return null;
  return { subscription, resourceGroup, resourceName, metricNamespace };
}

/** Lists resources in a subscription, optionally narrowed to one group/type. */
async function listArmResources(
  dsUid: string, subscription: string, resourceGroup: string, resourceType?: string,
): Promise<ArmResource[]> {
  if (!subscription) return [];
  const base = resourceGroup
    ? `subscriptions/${subscription}/resourceGroups/${encodeURIComponent(resourceGroup)}/resources`
    : `subscriptions/${subscription}/resources`;
  const filter = resourceType ? `&$filter=${encodeURIComponent(`resourceType eq '${resourceType}'`)}` : "";
  const json = await arm<ArmList<ArmResource>>(dsUid, `${base}?api-version=2021-04-01${filter}`);
  return json?.value ?? [];
}

const defaultPanels: Panel[] = [
  { title: "CPU Percentage", unit: "percent", namespace: VM_TYPE, statistic: "Average", period: "PT5M",
    series: [{ label: "CPU %", metricName: "Percentage CPU" }] },
  { title: "Network In / Out", unit: "bytes", namespace: VM_TYPE, statistic: "Total", period: "PT5M",
    series: [
      { label: "In", metricName: "Network In Total" },
      { label: "Out", metricName: "Network Out Total", color: "#ffd27f" },
    ] },
  { title: "Disk Read / Write", unit: "bytes", namespace: VM_TYPE, statistic: "Total", period: "PT5M",
    series: [
      { label: "Read", metricName: "Disk Read Bytes", color: "#c39dff" },
      { label: "Write", metricName: "Disk Write Bytes", color: "#7fc7ff" },
    ] },
  { title: "Available Memory", unit: "bytes", namespace: VM_TYPE, statistic: "Average", period: "PT5M",
    series: [{ label: "Available", metricName: "Available Memory Bytes", color: "#7ee6c2" }] },
];

export const azure: CloudProvider = {
  id: "azure",
  label: "Microsoft Azure",
  short: "Az",
  color: "#0089d6",
  description: "Azure Monitor metrics for VMs, App Service, SQL and more.",
  datasourceType: AZURE_DATASOURCE_TYPE,

  terms: {
    account: "Azure subscription",
    scope: "Resource group",
    resource: "Resources",
    namespace: "Resource type",
    statistic: "Aggregation",
  },

  // Azure Monitor's aggregation vocabulary: "Total" is Azure's "Sum".
  statistics: ["Average", "Total", "Maximum", "Minimum", "Count"],
  defaultPeriod: "PT5M",

  accountFields: [
    { key: "tenantId", label: "Directory (tenant) ID", placeholder: "00000000-0000-0000-0000-000000000000" },
    { key: "clientId", label: "Application (client) ID", placeholder: "00000000-0000-0000-0000-000000000000" },
    { key: "clientSecret", label: "Client secret", placeholder: "secret", secret: true },
    { key: "subscriptionId", label: "Subscription ID", placeholder: "00000000-0000-0000-0000-000000000000" },
  ],

  buildDatasource(name, v) {
    return {
      name,
      type: AZURE_DATASOURCE_TYPE,
      access: "proxy",
      jsonData: {
        cloudName: "azuremonitor",
        azureAuthType: "clientsecret",
        tenantId: v["tenantId"] ?? "",
        clientId: v["clientId"] ?? "",
        subscriptionId: v["subscriptionId"] ?? "",
      },
      secureJsonData: { clientSecret: v["clientSecret"] ?? "" },
    };
  },

  /** No resource group selected means "whole subscription". */
  defaultScope() {
    return "";
  },

  async listScopes(dsUid, account) {
    const sub = subscriptionOf(account);
    if (!sub) return [];
    const json = await arm<ArmList<{ name: string }>>(
      dsUid, `subscriptions/${sub}/resourcegroups?api-version=2021-04-01`,
    );
    return (json?.value ?? []).map((g) => g.name).filter(Boolean);
  },

  async listNamespaces(dsUid, scope, account) {
    const found = await listArmResources(dsUid, subscriptionOf(account), scope);
    const types = [...new Set(found.map((r) => r.type).filter(Boolean))].sort();
    return types.length ? types : FALLBACK_NAMESPACES;
  },

  async listMetrics(dsUid, scope, namespace, account) {
    // Metric definitions in Azure are per-resource, not per-type, so query a
    // representative resource of this type and read its definitions.
    const found = await listArmResources(dsUid, subscriptionOf(account), scope, namespace);
    const sample = found[0];
    if (!sample) return [];
    const json = await arm<ArmList<MetricDefinition>>(
      dsUid,
      `${sample.id.replace(/^\//, "")}/providers/microsoft.insights/metricdefinitions` +
        `?api-version=2018-01-01&metricnamespace=${encodeURIComponent(namespace)}`,
    );
    return [
      ...new Set((json?.value ?? []).map((m) => m.name?.value ?? "").filter(Boolean)),
    ];
  },

  async listResources(dsUid, scope, account): Promise<CloudResource[]> {
    const found = await listArmResources(dsUid, subscriptionOf(account), scope, VM_TYPE);
    return found.map((r) => ({ id: r.id, label: r.name }));
  },

  async listDimensionKeys(dsUid, scope, namespace, metricName, account) {
    const found = await listArmResources(dsUid, subscriptionOf(account), scope, namespace);
    const sample = found[0];
    if (!sample) return [];
    const json = await arm<ArmList<MetricDefinition>>(
      dsUid,
      `${sample.id.replace(/^\//, "")}/providers/microsoft.insights/metricdefinitions` +
        `?api-version=2018-01-01&metricnamespace=${encodeURIComponent(namespace)}`,
    );
    const def = (json?.value ?? []).find((m) => m.name?.value === metricName);
    return (def?.dimensions ?? []).map((d) => d.value ?? "").filter(Boolean);
  },

  /**
   * Azure has no cheap "list values for this dimension" endpoint — values only
   * appear in query results. Returning empty makes the Value dropdown render
   * its "-" placeholder, and the dimension filter is simply skipped.
   */
  async listDimensionValues() {
    return [];
  },

  /** Azure metrics are always addressed by resource URI. */
  isResourceScoped() {
    return true;
  },

  buildQuery(ctx: QueryContext) {
    const parsed = ctx.resourceId ? parseResourceUri(ctx.resourceId) : null;
    const dimensionFilters = Object.entries(ctx.dimensions ?? {}).map(([dimension, value]) => ({
      dimension,
      operator: "eq",
      filters: [value],
    }));
    return {
      refId: ctx.refId,
      datasource: { type: AZURE_DATASOURCE_TYPE, uid: ctx.dsUid },
      queryType: "Azure Monitor",
      subscription: parsed?.subscription ?? "",
      azureMonitor: {
        metricNamespace: parsed?.metricNamespace ?? ctx.namespace,
        metricName: ctx.metricName,
        aggregation: ctx.statistic,
        timeGrain: ctx.period || "auto",
        resources: parsed
          ? [{
              subscription: parsed.subscription,
              resourceGroup: parsed.resourceGroup,
              resourceName: parsed.resourceName,
              metricNamespace: parsed.metricNamespace,
            }]
          : [],
        dimensionFilters,
        allowedTimeGrainsMs: [],
      },
    };
  },

  fleetNamespace: VM_TYPE,
  fleetMetrics: [
    { key: "cpu", metricName: "Percentage CPU", statistic: "Average" },
    { key: "netIn", metricName: "Network In Total", statistic: "Total" },
    { key: "netOut", metricName: "Network Out Total", statistic: "Total" },
    // 1 = available. The table inverts this into a failure count so both
    // providers can share one health column.
    { key: "health", metricName: "VmAvailabilityMetric", statistic: "Average" },
  ],

  defaultPanels,
};
