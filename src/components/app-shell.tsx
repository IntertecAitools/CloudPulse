import { Link, useRouterState } from "@tanstack/react-router";
import { Activity, Server, Boxes, HardDrive, ScrollText, Waypoints, BellRing, Settings as SettingsIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { PulseMark } from "@/components/pulse-mark";
import { getProvider, loadActiveProvider, type ProviderId } from "@/lib/providers";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIME_RANGES, useTimeRange, type TimeRangeValue } from "@/lib/time-range";

const NAV = [
  { title: "Overview", to: "/overview", icon: Activity },
  { title: "Infrastructure", to: "/infrastructure", icon: Server },
  { title: "Kubernetes", to: "/kubernetes", icon: Boxes },
  { title: "Servers", to: "/servers", icon: HardDrive },
  { title: "Logs", to: "/logs", icon: ScrollText },
  { title: "Traces", to: "/traces", icon: Waypoints },
  { title: "Alerts", to: "/alerts", icon: BellRing },
  { title: "Settings", to: "/settings", icon: SettingsIcon },
] as const;

/** Shows which cloud the app is currently pointed at, and links out to switch. */
function ProviderBadge() {
  const [providerId, setProviderId] = useState<ProviderId>("aws");
  // localStorage is client-only, so read after mount to keep SSR deterministic.
  useEffect(() => setProviderId(loadActiveProvider()), []);
  const provider = getProvider(providerId);

  return (
    <Link
      to="/providers"
      className="mx-3 mt-3 flex items-center gap-2.5 rounded-md border border-border bg-background/60 px-3 py-2 transition-colors hover:border-primary/50 hover:bg-white/[0.03]"
    >
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-[10px] font-bold text-white"
        style={{ background: provider.color }}>
        {provider.short}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-foreground">{provider.label}</span>
        <span className="block text-[10px] text-muted-foreground">switch provider</span>
      </span>
    </Link>
  );
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[240px] flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl md:flex">
      <Link to="/" className="flex h-16 items-center gap-2.5 border-b border-border px-5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent/15 text-accent">
          <PulseMark className="h-4 w-4" />
        </span>
        <span className="truncate text-[15px] font-semibold tracking-[0.08em] text-foreground">
          CloudPulse
        </span>
      </Link>
      <ProviderBadge />
      <nav className="flex flex-col gap-0.5 p-3">
        {/* Prefix matching is correct for every item now that Overview lives
            at /overview rather than "/", so no activeOptions guard is needed. */}
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground data-[status=active]:bg-accent/10 data-[status=active]:text-accent"
          >
            <item.icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{item.title}</span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto p-4 text-xs text-muted-foreground">v1.0 · all systems nominal</div>
    </aside>
  );
}

function TopBar({ title }: { title: string }) {
  const { range, setRange } = useTimeRange();
  return (
    <header className="sticky top-0 z-10 grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-background/95 px-5 backdrop-blur md:px-8">
      <h1 className="truncate text-base font-semibold tracking-tight text-foreground">{title}</h1>
      <Select value={range} onValueChange={(v) => setRange(v as TimeRangeValue)}>
        <SelectTrigger className="w-[170px] shrink-0 border-border bg-card text-sm text-foreground">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-border bg-card">
          {TIME_RANGES.map((r) => (
            <SelectItem
              key={r.value}
              value={r.value}
              className="text-sm text-foreground focus:bg-accent/10 focus:text-accent"
            >
              {r.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </header>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = NAV.find((n) => pathname.startsWith(n.to));

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <div className="md:pl-[240px]">
        <TopBar title={active?.title ?? "Overview"} />
        <main className="p-5 md:p-8">{children}</main>
      </div>
    </div>
  );
}
