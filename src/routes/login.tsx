import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { tryLogin } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in - CloudPulse" }] }),
  component: Login,
});

function Login() {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    const ok = await tryLogin(user.trim(), pass);
    if (ok) { location.href = "/providers"; return; }
    setError("Invalid username or password");
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-8">
        <div className="space-y-1 text-center">
          <h1 className="text-lg font-semibold text-foreground">CloudPulse</h1>
          <p className="text-xs text-muted-foreground">Sign in to your monitoring workspace</p>
        </div>
        <div className="space-y-3">
          <label className="block text-xs text-muted-foreground">Username
            <input value={user} onChange={(e) => setUser(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
          <label className="block text-xs text-muted-foreground">Password
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground" />
          </label>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button onClick={submit} disabled={busy || !user || !pass}
          className="w-full rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          New user? <Link to="/register" className="text-primary hover:underline">Register</Link>
        </p>
      </div>
    </div>
  );
}
