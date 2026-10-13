import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { tryLogin } from "@/lib/auth";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Register - CloudPulse" }] }),
  component: Register,
});

function Register() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setBusy(true);
    try {
      const res = await fetch("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Registration failed"); setBusy(false); return; }
      const ok = await tryLogin(username.trim(), password);
      location.href = ok ? "/providers" : "/login";
    } catch {
      setError("Could not reach the server");
      setBusy(false);
    }
  };

  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") submit(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold text-foreground">Create account</h1>
          <p className="text-xs text-muted-foreground">Create your CloudPulse account</p>
        </div>
        <div className="space-y-3">
          <Field label="Username" value={username} onChange={setUsername} onKeyDown={onEnter} autoFocus />
          <Field label="Password" value={password} onChange={setPassword} onKeyDown={onEnter} password />
          <Field label="Confirm password" value={confirm} onChange={setConfirm} onKeyDown={onEnter} password />
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={submit} disabled={busy || !username || !password || !confirm}
          className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
          {busy ? "Creating..." : "Create account"}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, password, autoFocus, onKeyDown }: {
  label: string; value: string; onChange: (v: string) => void;
  password?: boolean; autoFocus?: boolean; onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  return (
    <label className="block text-xs text-muted-foreground">{label}
      <input type={password ? "password" : "text"} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
        className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
    </label>
  );
}
