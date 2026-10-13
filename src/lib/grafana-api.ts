import { authFetch } from "@/lib/auth";
import {
  PROVIDER_LIST,
  getProvider,
  providerForAccount,
  type Account,
  type CloudResource,
  type ProviderId,
} from "@/lib/providers";

export type { Account, CloudResource, ProviderId } from "@/lib/providers";
export { ALL_REGIONS } from "@/lib/providers";

/** Every Grafana datasource backed by a provider CloudPulse understands. */
export async function listAllAccounts(): Promise<Account[]> {
  const r = await authFetch("/grafana/api/datasources");
  if (!r.ok) throw new Error("Failed to load accounts");
  const all = await r.json();
  const known = new Set(PROVIDER_LIST.map((p) => p.datasourceType));
  return (Array.isArray(all) ? all : []).filter((d: Account) => known.has(d.type));
}

/** Accounts belonging to one provider. */
export async function listAccounts(providerId: ProviderId): Promise<Account[]> {
  const type = getProvider(providerId).datasourceType;
  return (await listAllAccounts()).filter((a) => a.type === type);
}

export async function addAccount(
  providerId: ProviderId,
  name: string,
  values: Record<string, string>,
) {
  const r = await authFetch("/grafana/api/datasources", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(getProvider(providerId).buildDatasource(name, values)),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as { message?: string }).message || "Failed to add account");
  }
  return r.json();
}

export async function removeAccount(uid: string) {
  const r = await authFetch(`/grafana/api/datasources/uid/${uid}`, { method: "DELETE" });
  if (!r.ok) throw new Error("Failed to remove account");
}

/*
 * Discovery. Every call dispatches on the account's provider, so callers never
 * branch on cloud. `scope` is a region on AWS and a resource group on Azure —
 * use provider.terms.scope when labelling it.
 */
export const discovery = {
  scopes: (a: Account) => providerForAccount(a).listScopes(a.uid, a),

  namespaces: (a: Account, scope: string) => providerForAccount(a).listNamespaces(a.uid, scope, a),

  metrics: (a: Account, scope: string, namespace: string) =>
    providerForAccount(a).listMetrics(a.uid, scope, namespace, a),

  resources: (a: Account, scope: string): Promise<CloudResource[]> =>
    providerForAccount(a).listResources(a.uid, scope, a),

  dimensionKeys: (a: Account, scope: string, namespace: string, metricName: string) =>
    providerForAccount(a).listDimensionKeys(a.uid, scope, namespace, metricName, a),

  dimensionValues: (
    a: Account, scope: string, namespace: string, metricName: string, key: string,
  ) => providerForAccount(a).listDimensionValues(a.uid, scope, namespace, metricName, key, a),
};
