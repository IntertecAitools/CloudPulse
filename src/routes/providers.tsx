import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRequireAuth, clearCreds } from "@/lib/auth";
import { listAllAccounts } from "@/lib/grafana-api";
import { PLANNED_PROVIDERS, PROVIDER_LIST, saveActiveProvider, type ProviderId } from "@/lib/providers";

export const Route = createFileRoute("/providers")({
  head: () => ({ meta: [{ title: "Cloud Providers - CloudPulse" }] }),
  component: Providers,
});

function Providers() {
  useRequireAuth();
  const navigate = useNavigate();
  const [connected, setConnected] = useState<Record<string, number>>({});

  useEffect(() => {
    listAllAccounts().then((accounts) => {
      const counts: Record<string, number> = {};
      for (const p of PROVIDER_LIST) {
        counts[p.id] = accounts.filter((a) => a.type === p.datasourceType).length;
      }
      setConnected(counts);
    }).catch(() => {});
  }, []);

  const choose = (id: ProviderId) => {
    saveActiveProvider(id);
    navigate({ to: "/overview" });
  };

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-xl font-semibold text-foreground">CloudPulse</h1>
          <button onClick={() => { clearCreds(); location.href = "/login"; }}
            className="text-xs text-muted-foreground hover:text-red-400">Sign out</button>
        </div>
        <p className="mb-8 text-sm text-muted-foreground">Choose a cloud provider to monitor.</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PROVIDER_LIST.map((p) => {
            const count = connected[p.id] ?? 0;
            return (
              <button key={p.id} onClick={() => choose(p.id)}
                className="group relative flex cursor-pointer flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-white/[0.03]">
                <div className="flex w-full items-center justify-between">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold text-white"
                    style={{ background: p.color }}>
                    {p.short}
                  </span>
                  {count > 0 ? (
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-400">
                      {count} connected
                    </span>
                  ) : (
                    <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">
                      Not connected
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{p.label}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.description}</p>
                </div>
                <span className="mt-auto text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100">
                  {count > 0 ? "Open dashboards →" : "Connect in Settings →"}
                </span>
              </button>
            );
          })}

          {PLANNED_PROVIDERS.map((p) => (
            <button key={p.id} disabled
              className="group relative flex cursor-not-allowed flex-col items-start gap-3 rounded-lg border border-border bg-card p-5 text-left opacity-55">
              <div className="flex w-full items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-md text-sm font-bold text-white"
                  style={{ background: p.color }}>
                  {p.short}
                </span>
                <span className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground">Coming soon</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{p.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{p.desc}</p>
              </div>
            </button>
          ))}
        </div>

        <p className="mt-8 text-[11px] text-muted-foreground">
          AWS and Azure are fully supported. More providers are on the roadmap.
        </p>
      </div>
    </div>
  );
}
