// Thin JSON fetch over the API. The Vite dev server proxies /api → :8080.
// The bearer token lives only in this module variable (in-memory; cleared on
// refresh, per ARCHITECTURE §6).

let authToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Registered once by the app to clear auth state + redirect on any 401. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

function handle(res: Response, path: string, method: string): void {
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error(`${method} ${path} unauthorized`);
  }
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  handle(res, path, "GET");
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  handle(res, path, "POST");
  // 204 No Content (e.g. change-password) has an empty body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PATCH",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  handle(res, path, "PATCH");
  return res.json() as Promise<T>;
}
