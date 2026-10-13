import type { Panel } from "@/config/panels";

export type ProviderId = "aws" | "azure";

export type Account = {
  id: number;
  uid: string;
  name: string;
  type: string;
  jsonData?: {
    /** AWS */
    defaultRegion?: string;
    /** Azure */
    subscriptionId?: string;
    tenantId?: string;
    clientId?: string;
    cloudName?: string;
  };
};

/** Something you can point a panel at: an EC2 instance, an Azure VM. */
export type CloudResource = {
  /**
   * Opaque, provider-specific handle. Stored in panels and alert rules, and
   * handed back to buildQuery untouched.
   *   AWS   — the instance id, e.g. "i-0abc123"
   *   Azure — the full ARM resource URI, which also carries the subscription
   *           and resource group so queries need no extra lookup.
   */
  id: string;
  label: string;
};

export type AccountField = {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
};

export type QueryContext = {
  refId: string;
  dsUid: string;
  /** AWS: region. Azure: resource group (see terms.scope). */
  scope: string;
  namespace: string;
  metricName: string;
  statistic: string;
  period: string;
  /** Provider resource handle; empty means "aggregate / not resource-scoped". */
  resourceId?: string;
  dimensions?: Record<string, string>;
};

/** Which fleet column a metric feeds on the Infrastructure page. */
export type FleetMetric = {
  key: "cpu" | "netIn" | "netOut" | "health";
  metricName: string;
  statistic: string;
};

export interface CloudProvider {
  id: ProviderId;
  label: string;
  /** Brand colour for the provider picker. */
  color: string;
  short: string;
  description: string;
  /** Grafana datasource type backing this provider. */
  datasourceType: string;

  /**
   * Vocabulary differences that reach the UI. The two clouds do not name the
   * same concepts the same way, and showing "Region" above a list of Azure
   * resource groups would just be wrong.
   */
  terms: {
    account: string;
    scope: string;
    resource: string;
    namespace: string;
    statistic: string;
  };

  statistics: readonly string[];
  /** Period/grain a newly built panel gets. CloudWatch wants seconds, Azure
   *  Monitor wants an ISO 8601 duration. */
  defaultPeriod: string;
  /** Fields collected by the "connect an account" form in Settings. */
  accountFields: readonly AccountField[];
  /** Turn those field values into a Grafana datasource creation payload. */
  buildDatasource(name: string, values: Record<string, string>): Record<string, unknown>;

  /** The scope (region / resource group) a new selection defaults to. */
  defaultScope(account: Account | undefined): string;
  listScopes(dsUid: string, account: Account | undefined): Promise<string[]>;
  listNamespaces(dsUid: string, scope: string, account: Account | undefined): Promise<string[]>;
  listMetrics(dsUid: string, scope: string, namespace: string, account: Account | undefined): Promise<string[]>;
  listResources(dsUid: string, scope: string, account: Account | undefined): Promise<CloudResource[]>;
  listDimensionKeys(
    dsUid: string, scope: string, namespace: string, metricName: string, account: Account | undefined,
  ): Promise<string[]>;
  listDimensionValues(
    dsUid: string, scope: string, namespace: string, metricName: string, key: string,
    account: Account | undefined,
  ): Promise<string[]>;

  /**
   * Does a panel fan out across the selected resources (one query per
   * resource), or does it aggregate on its own dimensions?
   */
  isResourceScoped(panel: Panel): boolean;
  buildQuery(ctx: QueryContext): Record<string, unknown>;

  /** Namespace and metrics backing the Infrastructure fleet table. */
  fleetNamespace: string;
  fleetMetrics: readonly FleetMetric[];
  defaultPanels: Panel[];
}
