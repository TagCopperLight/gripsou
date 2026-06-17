// Thin JSON fetch over the API. The Vite dev server proxies /api → :8080.
// The bearer token is persisted in localStorage (remembered) or sessionStorage
// (not remembered) so the user stays logged in across page refreshes.

const TOKEN_KEY = "gripsou.token";

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let authToken: string | null = loadToken();
let onUnauthorized: (() => void) | null = null;

export function setAuthToken(token: string | null, remember = false): void {
  authToken = token;
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    if (token) {
      (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
    }
  } catch {
    // Storage unavailable (e.g. private mode or server-side); in-memory only.
  }
}

export function getAuthToken(): string | null {
  return authToken;
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

type HandleOptions = { skipGlobalUnauthorized?: boolean };

function handle(res: Response, path: string, method: string, opts?: HandleOptions): void {
  if (res.status === 401) {
    if (!opts?.skipGlobalUnauthorized) onUnauthorized?.();
    throw new Error(`${method} ${path} unauthorized`);
  }
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
}

export type GetJsonOptions = { skipGlobalUnauthorized?: boolean };

export async function getJson<T>(path: string, opts?: GetJsonOptions): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  handle(res, path, "GET", opts);
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

export async function deleteJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "DELETE",
    headers:
      body === undefined
        ? authHeaders()
        : authHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  handle(res, path, "DELETE");
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
