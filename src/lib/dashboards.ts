import type { Panel } from "@/config/panels";
import { authFetch } from "@/lib/auth";
import { getProvider, type ProviderId } from "@/lib/providers";

export type Dashboard = {
  id: string;
  name: string;
  /** Which cloud this dashboard's panels query. Absent on records written
   *  before multi-provider support; treated as AWS. */
  provider?: ProviderId;
  panels: Panel[];
};

const LOCAL_KEY = "cloudpulse.dashboards";
const ACTIVE_KEY = "cloudpulse.activeDashboard";

/**
 * The server stores one flat list across every provider, so this module keeps
 * the full set in memory and hands callers only the slice for the provider
 * they're viewing. Without that, saving an AWS dashboard would wipe the Azure
 * ones, since the API replaces the whole array.
 */
let allDashboards: Dashboard[] = [];

const providerOf = (d: Dashboard): ProviderId => d.provider ?? "aws";

function seedFor(provider: ProviderId): Dashboard {
  return {
    id: `default-${provider}`,
    name: "Overview",
    provider,
    panels: [...getProvider(provider).defaultPanels],
  };
}

export async function loadDashboards(provider: ProviderId): Promise<Dashboard[]> {
  let loaded: Dashboard[] | null = null;

  // 1. Server is the source of truth.
  try {
    const r = await authFetch("/dashboards-api/dashboards");
    if (r.ok) {
      const list = await r.json();
      if (Array.isArray(list) && list.length) loaded = list as Dashboard[];
    }
  } catch {
    /* fall through */
  }

  // 2. Server empty: migrate this browser's old localStorage dashboards.
  if (!loaded) {
    try {
      const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null");
      if (Array.isArray(raw) && raw.length) loaded = raw as Dashboard[];
    } catch {
      /* ignore */
    }
  }

  allDashboards = loaded ?? [];

  // 3. Nothing for this provider yet: seed its starter dashboard.
  const mine = allDashboards.filter((d) => providerOf(d) === provider);
  if (mine.length === 0) {
    const seed = seedFor(provider);
    allDashboards = [...allDashboards, seed];
    persist();
    return [seed];
  }
  return mine;
}

export function saveDashboards(provider: ProviderId, forProvider: Dashboard[]) {
  const others = allDashboards.filter((d) => providerOf(d) !== provider);
  allDashboards = [...others, ...forProvider.map((d) => ({ ...d, provider }))];
  persist();
}

function persist() {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(allDashboards));
  } catch {
    /* offline backup only */
  }
  authFetch("/dashboards-api/dashboards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(allDashboards),
  }).catch(() => {});
}

export function loadActiveId(provider: ProviderId): string {
  if (typeof window === "undefined") return `default-${provider}`;
  return localStorage.getItem(`${ACTIVE_KEY}.${provider}`) ?? `default-${provider}`;
}

export function saveActiveId(provider: ProviderId, id: string) {
  localStorage.setItem(`${ACTIVE_KEY}.${provider}`, id);
}

export function newId(): string {
  return `d-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}
