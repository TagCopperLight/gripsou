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

/** An HTTP failure with its status attached, so callers can branch on 409/404
 *  instead of parsing the message. Thrown by every helper in this module. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function handle(res: Response, path: string, method: string, opts?: HandleOptions): void {
  if (res.status === 401) {
    if (!opts?.skipGlobalUnauthorized) onUnauthorized?.();
    throw new ApiError(`${method} ${path} unauthorized`, 401);
  }
  if (!res.ok) throw new ApiError(`${method} ${path} failed: ${res.status}`, res.status);
}

/** The body as JSON, or `undefined` when there is none: 204 No Content, and a
 *  202 Accepted that only says "started" (e.g. POST /budget/categorize). */
async function bodyOf<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

export type GetJsonOptions = { skipGlobalUnauthorized?: boolean };

export async function getJson<T>(path: string, opts?: GetJsonOptions): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: authHeaders() });
  handle(res, path, "GET", opts);
  return res.json() as Promise<T>;
}

export async function postJson<T>(path: string, body: unknown, opts?: HandleOptions): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  handle(res, path, "POST", opts);
  // 204 No Content (e.g. change-password) and a bare 202 have empty bodies.
  return bodyOf<T>(res);
}

export async function putJson<T>(path: string, body: unknown, opts?: HandleOptions): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  handle(res, path, "PUT", opts);
  // 204 No Content (e.g. save-lots) has an empty body.
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
  // 204 No Content (e.g. /settings/cors, /settings/budget-ai) has an empty body.
  return bodyOf<T>(res);
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
