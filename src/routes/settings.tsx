import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { listAllAccounts, addAccount, removeAccount, ALL_REGIONS, type Account } from "@/lib/grafana-api";
import { PROVIDER_LIST, providerForAccount, type ProviderId } from "@/lib/providers";
import { useRequireAuth, clearCreds, currentUser, updateStoredPassword, authFetch } from "@/lib/auth";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings - CloudPulse" }] }),
  component: Settings,
});

const TABS = ["Profile", "Cloud Accounts", "About"] as const;

function Settings() {
  useRequireAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Profile");

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === t ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground"
            }`}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Profile" && <ProfileTab />}
      {tab === "Cloud Accounts" && <AccountsTab />}
      {tab === "About" && <AboutTab />}
    </div>
  );
}

/* ---------------- Profile ---------------- */

function ProfileTab() {
  const user = currentUser();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const change = async () => {
    setMsg(null);
    if (next !== confirm) { setMsg({ ok: false, text: "New passwords do not match" }); return; }
    setBusy(true);
    try {
      const res = await fetch("/auth/change-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, currentPassword: cur, newPassword: next }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j.error || "Failed" }); setBusy(false); return; }
      updateStoredPassword(next);
      setMsg({ ok: true, text: "Password updated" });
      setCur(""); setNext(""); setConfirm("");
    } catch { setMsg({ ok: false, text: "Could not reach the server" }); }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-accent/15 text-lg font-semibold text-accent">
            {(user ?? "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{user ?? "Unknown user"}</p>
            <p className="text-xs text-muted-foreground">Workspace member</p>
          </div>
          <button onClick={() => { clearCreds(); location.href = "/login"; }}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-red-400/40 hover:text-red-400">
            Sign out
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-foreground">Change password</h2>
        <Field label="Current password" value={cur} onChange={setCur} password />
        <Field label="New password (min 8 characters)" value={next} onChange={setNext} password />
        <Field label="Confirm new password" value={confirm} onChange={setConfirm} password />
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-400" : "text-red-400"}`}>{msg.text}</p>}
        <button onClick={change} disabled={busy || !cur || !next || !confirm}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
          {busy ? "Updating..." : "Update password"}
        </button>
      </section>
    </div>
  );
}

/* ---------------- Cloud Accounts ---------------- */

const CREDENTIAL_HELP: Record<ProviderId, string> = {
  aws: "Use an IAM user with only the CloudWatchReadOnlyAccess policy. Keys are stored in the backend and never sent to the browser.",
  azure: "Register an app in Microsoft Entra ID and grant it the Monitoring Reader role on the subscription. The client secret is stored in the backend and never sent to the browser.",
};

function AccountsTab() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>("aws");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [region, setRegion] = useState("us-east-1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const provider = PROVIDER_LIST.find((p) => p.id === providerId) ?? PROVIDER_LIST[0]!;
  const refresh = () => listAllAccounts().then(setAccounts).catch(() => {});
  useEffect(() => { refresh(); }, []);

  // Each provider asks for a different set of credentials.
  useEffect(() => { setValues({}); setMsg(null); }, [providerId]);

  const set = (k: string, v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const complete = provider.accountFields.every((f) => (values[f.key] ?? "").trim());

  const submit = async () => {
    setBusy(true); setMsg(null);
    try {
      const payload: Record<string, string> = { region };
      for (const f of provider.accountFields) payload[f.key] = (values[f.key] ?? "").trim();
      await addAccount(providerId, name.trim(), payload);
      setMsg("Account added"); setName(""); setValues({});
      refresh();
    } catch (e) { setMsg((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-foreground">Connect a cloud account</h2>

        <div className="flex gap-1 rounded-md border border-border bg-background p-1">
          {PROVIDER_LIST.map((p) => (
            <button key={p.id} onClick={() => setProviderId(p.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded px-3 py-1.5 text-xs transition-colors ${
                providerId === p.id ? "bg-accent/10 text-accent" : "text-muted-foreground hover:text-foreground"
              }`}>
              <span className="grid h-4 w-4 place-items-center rounded-sm text-[8px] font-bold text-white"
                style={{ background: p.color }}>{p.short}</span>
              {p.label}
            </button>
          ))}
        </div>

        <Field label="Account name" value={name} onChange={setName} placeholder="e.g. Production" />
        {provider.accountFields.map((f) => (
          <Field key={f.key} label={f.label} value={values[f.key] ?? ""}
            onChange={(v) => set(f.key, v)}
            {...(f.placeholder ? { placeholder: f.placeholder } : {})}
            {...(f.secret ? { password: true } : {})} />
        ))}

        {provider.id === "aws" && (
          <label className="block text-xs text-muted-foreground">Default region
            <select value={region} onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground">
              {ALL_REGIONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        )}

        <button onClick={submit} disabled={busy || !name || !complete}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
          {busy ? "Adding..." : "Add account"}
        </button>
        {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
        <p className="text-[11px] leading-relaxed text-muted-foreground">{CREDENTIAL_HELP[providerId]}</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-foreground">Connected accounts</h2>
        {accounts.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
        {accounts.map((a) => {
          const p = providerForAccount(a);
          return (
            <div key={a.uid} className="flex items-center justify-between rounded border border-border px-3 py-2">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-[9px] font-bold text-white"
                  style={{ background: p.color }}>{p.short}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{a.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {a.jsonData?.defaultRegion ?? a.jsonData?.subscriptionId ?? p.label}
                  </p>
                </div>
              </div>
              <button onClick={() => { if (window.confirm(`Remove "${a.name}"? Panels using it will stop loading.`)) removeAccount(a.uid).then(refresh); }}
                className="shrink-0 text-xs text-red-400 hover:underline">Remove</button>
            </div>
          );
        })}
      </section>
    </div>
  );
}

/* ---------------- About ---------------- */

function AboutTab() {
  const [counts, setCounts] = useState<{ accounts: number; dashboards: number; alerts: number } | null>(null);

  useEffect(() => {
    Promise.all([
      listAllAccounts().catch(() => []),
      authFetch("/dashboards-api/dashboards").then((r) => r.json()).catch(() => []),
      authFetch("/alerts-api/rules").then((r) => r.json()).catch(() => []),
    ]).then(([a, d, al]) => setCounts({
      accounts: Array.isArray(a) ? a.length : 0,
      dashboards: Array.isArray(d) ? d.length : 0,
      alerts: Array.isArray(al) ? al.length : 0,
    }));
  }, []);

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">CloudPulse</h2>
        <p className="text-xs text-muted-foreground">v1.0 · self-hosted cloud monitoring</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Cloud accounts", v: counts?.accounts },
          { label: "Dashboards", v: counts?.dashboards },
          { label: "Alert rules", v: counts?.alerts },
        ].map((x) => (
          <div key={x.label} className="rounded border border-border bg-background/50 p-3 text-center">
            <p className="text-lg font-semibold text-foreground">{x.v ?? "-"}</p>
            <p className="text-[11px] text-muted-foreground">{x.label}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Providers: AWS and Azure (live) · GCP, Oracle, Huawei (coming soon). Alert rules are evaluated every 60 seconds.
      </p>
    </section>
  );
}

/* ---------------- shared ---------------- */

function Field({ label, value, onChange, placeholder, password }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; password?: boolean;
}) {
  return (
    <label className="block text-xs text-muted-foreground">{label}
      <input type={password ? "password" : "text"} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
    </label>
  );
}
