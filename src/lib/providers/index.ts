import { aws } from "./aws";
import { azure } from "./azure";
import type { Account, CloudProvider, ProviderId } from "./types";

export type { Account, CloudProvider, CloudResource, ProviderId, QueryContext } from "./types";
export { ALL_REGIONS } from "./aws";
export { parseResourceUri } from "./azure";

export const PROVIDERS: Record<ProviderId, CloudProvider> = { aws, azure };
export const PROVIDER_LIST: CloudProvider[] = [aws, azure];

/** Providers that aren't wired up yet — shown as "coming soon" in the picker. */
export const PLANNED_PROVIDERS = [
  { id: "gcp", name: "Google Cloud", short: "G", color: "#34a853",
    desc: "Cloud Monitoring for GCE, GKE, Cloud Run and more." },
  { id: "oracle", name: "Oracle Cloud", short: "O", color: "#f80000",
    desc: "OCI Monitoring for compute, storage and databases." },
  { id: "huawei", name: "Huawei Cloud", short: "H", color: "#cf0a2c",
    desc: "Cloud Eye metrics for ECS, OBS and RDS." },
] as const;

export function getProvider(id: ProviderId | string | undefined): CloudProvider {
  return PROVIDERS[(id as ProviderId) ?? "aws"] ?? aws;
}

/** Which provider backs a given Grafana datasource. */
export function providerForAccount(account: Account | undefined): CloudProvider {
  return PROVIDER_LIST.find((p) => p.datasourceType === account?.type) ?? aws;
}

const ACTIVE_KEY = "cloudpulse.activeProvider";

export function loadActiveProvider(): ProviderId {
  if (typeof window === "undefined") return "aws";
  const v = localStorage.getItem(ACTIVE_KEY);
  return v === "azure" || v === "aws" ? v : "aws";
}

export function saveActiveProvider(id: ProviderId) {
  if (typeof window !== "undefined") localStorage.setItem(ACTIVE_KEY, id);
}
