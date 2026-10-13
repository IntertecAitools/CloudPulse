import { authFetch } from "@/lib/auth";

/**
 * Zabbix access.
 *
 * Goes through the Grafana datasource's `zabbix-api` resource route, which is
 * a passthrough to Zabbix's JSON-RPC API with Grafana supplying the session —
 * so CloudPulse never handles Zabbix credentials, and the call rides the same
 * authenticated /grafana/ path as everything else.
 *
 * Two things this deliberately does NOT use:
 *  - `/api/ds/query` for problems: the backend rejects them with "non-metrics
 *    queries are not supported" (the plugin resolves those browser-side).
 *  - `/resources/hosts` and friends: they exist but are a catch-all stub that
 *    answers "Hello from Zabbix data source!".
 */

export const ZABBIX_UID = "cloudpulse-zabbix";

const API = `/grafana/api/datasources/uid/${ZABBIX_UID}/resources/zabbix-api`;

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await authFetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!r.ok) throw new Error(`Zabbix request failed (${r.status})`);
  const j = await r.json();
  if (j?.error) throw new Error(j.error.data ?? j.error.message ?? "Zabbix API error");
  return (j?.result ?? []) as T;
}

/** Zabbix trigger priority. 0-5, low to disaster. */
export const SEVERITY = ["Not classified", "Information", "Warning", "Average", "High", "Disaster"] as const;

export type ZabbixHost = {
  hostid: string;
  name: string;
  /** false when the host is administratively disabled. */
  enabled: boolean;
  /** Agent reachability: up | down | unknown. */
  availability: "up" | "down" | "unknown";
  error: string;
  address: string;
  groups: string[];
  /** Key metrics, when the attached template provides them. */
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  uptime: number | null;
  items: number;
};

export type ZabbixProblem = {
  eventid: string;
  name: string;
  severity: number;
  host: string;
  clock: number;
  acknowledged: boolean;
};

type RawHost = {
  hostid: string; host: string; name: string; status: string;
  interfaces?: { ip?: string; dns?: string; port?: string; available?: string; error?: string }[];
  hostgroups?: { name: string }[];
};

type RawItem = { hostid: string; name: string; lastvalue: string; units: string };

/** First item whose name matches, as a number. */
function pick(items: RawItem[], re: RegExp): number | null {
  const hit = items.find((i) => re.test(i.name));
  if (!hit) return null;
  const v = Number(hit.lastvalue);
  return Number.isFinite(v) ? v : null;
}

export async function getHosts(): Promise<ZabbixHost[]> {
  const hosts = await rpc<RawHost[]>("host.get", {
    output: ["hostid", "host", "name", "status"],
    selectInterfaces: ["ip", "dns", "port", "available", "error"],
    selectHostGroups: ["name"],
  });
  if (hosts.length === 0) return [];

  // One bulk item.get rather than one per host. `search` with searchByAny
  // pulls every metric we surface in a single round trip.
  const items = await rpc<RawItem[]>("item.get", {
    hostids: hosts.map((h) => h.hostid),
    output: ["hostid", "name", "lastvalue", "units"],
    search: {
      name: ["Memory utilization", "CPU utilization", "Space utilization", "System uptime"],
    },
    searchByAny: true,
  }).catch(() => [] as RawItem[]);

  const counts = new Map<string, number>();
  const byHost = new Map<string, RawItem[]>();
  for (const it of items) {
    byHost.set(it.hostid, [...(byHost.get(it.hostid) ?? []), it]);
    counts.set(it.hostid, (counts.get(it.hostid) ?? 0) + 1);
  }

  return hosts.map((h) => {
    const iface = h.interfaces?.[0];
    const mine = byHost.get(h.hostid) ?? [];
    // Zabbix interface availability: 0 unknown, 1 available, 2 unavailable.
    const availability: ZabbixHost["availability"] =
      iface?.available === "1" ? "up" : iface?.available === "2" ? "down" : "unknown";
    return {
      hostid: h.hostid,
      name: h.name || h.host,
      enabled: h.status === "0",
      availability,
      error: iface?.error ?? "",
      address: iface ? `${iface.dns || iface.ip || "?"}:${iface.port ?? ""}` : "",
      groups: (h.hostgroups ?? []).map((g) => g.name),
      cpu: pick(mine, /^CPU utilization$/i),
      memory: pick(mine, /^Memory utilization$/i),
      disk: pick(mine, /Space utilization/i),
      uptime: pick(mine, /uptime/i),
      items: counts.get(h.hostid) ?? 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getProblems(): Promise<ZabbixProblem[]> {
  // problem.get has no selectHosts in Zabbix 7.0 — passing it fails the whole
  // call with 'unexpected parameter "selectHosts"'. The host lives on the
  // trigger the problem fired from, so resolve it in a second lookup.
  const problems = await rpc<{
    eventid: string; name: string; severity: string; clock: string;
    acknowledged: string; objectid: string;
  }[]>("problem.get", {
    output: ["eventid", "name", "severity", "clock", "acknowledged", "objectid"],
    recent: false,
    sortfield: ["eventid"],
    sortorder: "DESC",
    limit: 200,
  });
  if (problems.length === 0) return [];

  const triggers = await rpc<{ triggerid: string; hosts?: { name: string }[] }[]>("trigger.get", {
    triggerids: [...new Set(problems.map((p) => p.objectid))],
    output: ["triggerid"],
    selectHosts: ["name"],
  }).catch(() => []);
  const hostOf = new Map(triggers.map((t) => [t.triggerid, t.hosts?.[0]?.name ?? ""]));

  return problems.map((p) => ({
    eventid: p.eventid,
    name: p.name,
    severity: Number(p.severity) || 0,
    host: hostOf.get(p.objectid) ?? "",
    clock: Number(p.clock) * 1000,
    acknowledged: p.acknowledged === "1",
  }));
}

/** Is a Zabbix datasource configured at all? */
export async function isConfigured(): Promise<boolean> {
  try {
    const r = await authFetch("/grafana/api/datasources");
    if (!r.ok) return false;
    const all = await r.json();
    return (Array.isArray(all) ? all : []).some(
      (d: { type?: string }) => d.type === "alexanderzobnin-zabbix-datasource",
    );
  } catch {
    return false;
  }
}
