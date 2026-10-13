import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PanelCard } from "@/components/panel-card";
import { AddPanel } from "@/components/add-panel";
import type { Panel } from "@/config/panels";
import { discovery, listAccounts, type Account, type CloudResource } from "@/lib/grafana-api";
import { getProvider, loadActiveProvider, type ProviderId } from "@/lib/providers";
import {
  loadDashboards, saveDashboards, loadActiveId, saveActiveId, newId, type Dashboard,
} from "@/lib/dashboards";
import { useRequireAuth } from "@/lib/auth";

export const Route = createFileRoute("/overview")({
  head: () => ({ meta: [{ title: "Overview - CloudPulse Monitoring" }] }),
  component: Overview,
});

function Overview() {
  useRequireAuth();
  const [providerId, setProviderId] = useState<ProviderId>("aws");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountUid, setAccountUid] = useState("");
  const [resources, setResources] = useState<CloudResource[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scopeOverride, setScopeOverride] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [activeId, setActiveId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const provider = getProvider(providerId);
  const account = accounts.find((a) => a.uid === accountUid);
  const defaultScope = provider.defaultScope(account);
  const scope = scopeOverride || defaultScope;
  const active = dashboards.find((d) => d.id === activeId) ?? dashboards[0];

  // Provider choice is made on /providers and persisted; read it once.
  useEffect(() => setProviderId(loadActiveProvider()), []);

  useEffect(() => {
    if (!providerId) return;
    setAccounts([]); setAccountUid(""); setResources([]); setSelectedIds([]);
    loadDashboards(providerId).then((d) => {
      setDashboards(d);
      setActiveId(loadActiveId(providerId));
    });
    listAccounts(providerId).then((a) => {
      setAccounts(a);
      if (a.length && a[0]) setAccountUid(a[0].uid);
    }).catch(() => {});
  }, [providerId]);

  useEffect(() => {
    setScopeOverride("");
    if (account) discovery.scopes(account).then(setScopes).catch(() => setScopes([]));
  }, [account?.uid]);

  useEffect(() => {
    if (!account) return;
    setResources([]); setSelectedIds([]); setDiscoveryError(null);
    discovery.resources(account, scope).then((found) => {
      setResources(found);
      if (found.length && found[0]) setSelectedIds([found[0].id]);
    }).catch((e: Error) => setDiscoveryError(e.message));
  }, [account?.uid, scope]);

  const update = (next: Dashboard[]) => { setDashboards(next); saveDashboards(providerId, next); };
  const switchTo = (id: string) => { setActiveId(id); saveActiveId(providerId, id); };

  const createDashboard = () => {
    const name = window.prompt("Dashboard name:", "New dashboard");
    if (!name?.trim()) return;
    const d: Dashboard = { id: newId(), name: name.trim(), provider: providerId, panels: [] };
    update([...dashboards, d]);
    switchTo(d.id);
  };

  const renameDashboard = () => {
    if (!active) return;
    const name = window.prompt("Rename dashboard:", active.name);
    if (!name?.trim()) return;
    update(dashboards.map((d) => d.id === active.id ? { ...d, name: name.trim() } : d));
  };

  const deleteDashboard = () => {
    if (!active || dashboards.length <= 1) return;
    if (!window.confirm(`Delete dashboard "${active.name}"?`)) return;
    const next = dashboards.filter((d) => d.id !== active.id);
    update(next);
    if (next[0]) switchTo(next[0].id);
  };

  const savePanel = (p: Panel) => {
    if (!active) return;
    update(dashboards.map((d) => {
      if (d.id !== active.id) return d;
      const panels = editIndex === null
        ? [...d.panels, p]
        : d.panels.map((old, i) => (i === editIndex ? p : old));
      return { ...d, panels };
    }));
    setEditIndex(null);
  };

  const removePanel = (idx: number) => {
    if (!active) return;
    update(dashboards.map((d) =>
      d.id === active.id ? { ...d, panels: d.panels.filter((_, i) => i !== idx) } : d
    ));
  };

  const openAdd = () => { setEditIndex(null); setEditorOpen(true); };
  const openEdit = (idx: number) => { setEditIndex(idx); setEditorOpen(true); };
  const closeEditor = () => { setEditorOpen(false); setEditIndex(null); };

  const scopeOptions = useMemo(
    () => scopes.filter((s) => s !== defaultScope),
    [scopes, defaultScope],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select label="Dashboard" value={active?.id ?? ""} onChange={switchTo}
          options={dashboards.map((d) => ({ value: d.id, label: d.name }))} />
        <button onClick={createDashboard} className="rounded border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:bg-white/5">+ New</button>
        <button onClick={renameDashboard} className="rounded border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-white/5">Rename</button>
        {dashboards.length > 1 && (
          <button onClick={deleteDashboard} className="rounded border border-border bg-card px-2.5 py-1.5 text-xs text-red-400 hover:bg-white/5">Delete</button>
        )}
        <span className="mx-1 h-5 w-px bg-border" />
        <Select label="Account" value={accountUid} onChange={setAccountUid}
          options={accounts.map((a) => ({ value: a.uid, label: a.name }))} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {provider.terms.scope}
          <select value={scopeOverride} onChange={(e) => setScopeOverride(e.target.value)}
            className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
            <option value="">{defaultScope ? `Default (${defaultScope})` : "All"}</option>
            {scopeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <ResourcePicker label={provider.terms.resource} resources={resources}
          selected={selectedIds} onChange={setSelectedIds} />
        <button onClick={openAdd}
          className="ml-auto rounded border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-white/5">
          + Add panel
        </button>
      </div>

      {discoveryError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-xs text-red-400">
          {discoveryError}
        </div>
      )}

      {editorOpen && account && active && (
        <AddPanel account={account} scope={scope}
          initial={editIndex !== null ? (active.panels[editIndex] ?? null) : null}
          onAdd={savePanel} onClose={closeEditor} />
      )}

      {account && active ? (
        active.panels.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-6">
            {active.panels.map((panel, idx) => (
              <div key={`${active.id}-${idx}-${panel.title}`} className="relative">
                <div className="absolute right-3 top-3 z-10 flex gap-3">
                  <button onClick={() => openEdit(idx)}
                    className="text-[11px] text-muted-foreground hover:text-primary">edit</button>
                  <button onClick={() => removePanel(idx)}
                    className="text-[11px] text-muted-foreground hover:text-red-400">remove</button>
                </div>
                <PanelCard panel={panel} account={account} resourceIds={selectedIds} scope={scope} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Empty dashboard - click "+ Add panel" to build it.</p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          {accounts.length === 0
            ? `No ${provider.label} accounts connected - add one in Settings.`
            : "Loading..."}
        </p>
      )}
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
        {options.length === 0 && <option value="">-</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function ResourcePicker({ label, resources, selected, onChange }: {
  label: string; resources: CloudResource[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="relative text-xs text-muted-foreground">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1.5 text-sm text-foreground">
        {label}
        <span className="rounded bg-background px-1.5 py-0.5 text-[11px]">{selected.length}/{resources.length}</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-72 overflow-auto rounded border border-border bg-card p-2 shadow-lg">
          <div className="mb-1 flex gap-2">
            <button onClick={() => onChange(resources.map((r) => r.id))} className="text-[11px] hover:underline">All</button>
            <button onClick={() => onChange([])} className="text-[11px] hover:underline">None</button>
          </div>
          {resources.map((r) => (
            <label key={r.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-white/5">
              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
              <span className="truncate text-foreground" title={r.id}>{r.label}</span>
            </label>
          ))}
          {resources.length === 0 && <p className="px-1 py-1">None found.</p>}
        </div>
      )}
    </div>
  );
}
