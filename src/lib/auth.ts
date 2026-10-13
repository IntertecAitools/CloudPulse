const KEY = "cloudpulse.auth";

export function getCreds(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(KEY);
}
export function clearCreds() {
  if (typeof window !== "undefined") sessionStorage.removeItem(KEY);
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const c = getCreds();
  const headers = new Headers(init.headers);
  if (c) headers.set("Authorization", `Basic ${c}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && typeof window !== "undefined" && !location.pathname.startsWith("/login")) {
    clearCreds();
    location.href = "/login";
  }
  return res;
}

export async function tryLogin(user: string, pass: string): Promise<boolean> {
  const token = btoa(`${user}:${pass}`);
  const res = await fetch("/grafana/api/datasources", {
    headers: { Authorization: `Basic ${token}` },
  });
  if (res.ok) {
    sessionStorage.setItem(KEY, token);
    return true;
  }
  return false;
}

export function useRequireAuth() {
  if (typeof window !== "undefined" && !getCreds()) location.href = "/login";
}

export function currentUser(): string | null {
  const c = getCreds();
  if (!c) return null;
  try { return atob(c).split(":")[0] ?? null; } catch { return null; }
}

export function updateStoredPassword(newPass: string) {
  const u = currentUser();
  if (u) sessionStorage.setItem("cloudpulse.auth", btoa(`${u}:${newPass}`));
}
