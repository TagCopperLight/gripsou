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
  /** Seconds from a `Retry-After` header (429 throttling), else null. */
  readonly retryAfter: number | null;
  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function handle(res: Response, path: string, method: string, requestToken: string | null, opts?: HandleOptions): void {
  if (res.status === 401) {
    if (!opts?.skipGlobalUnauthorized && requestToken === authToken) onUnauthorized?.();
    throw new ApiError(`${method} ${path} unauthorized`, 401);
  }
  if (!res.ok) {
    const retry = Number(res.headers.get("Retry-After"));
    throw new ApiError(
      `${method} ${path} failed: ${res.status}`,
      res.status,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
}

/** The body as JSON, or `undefined` when there is none: 204 No Content, and a
 *  202 Accepted that only says "started" (e.g. POST /budget/categorize). */
async function bodyOf<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

export type GetJsonOptions = HandleOptions & { signal?: AbortSignal };

async function request<T>(method: string, path: string, body: unknown, opts?: GetJsonOptions): Promise<T> {
  const requestToken = authToken;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? authHeaders() : authHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(opts?.signal ? { signal: opts.signal } : {}),
  });
  handle(res, path, method, requestToken, opts);
  return bodyOf<T>(res);
}

export const getJson = <T>(path: string, opts?: GetJsonOptions) => request<T>("GET", path, undefined, opts);
export const postJson = <T>(path: string, body: unknown, opts?: HandleOptions) => request<T>("POST", path, body, opts);
export const putJson = <T>(path: string, body: unknown, opts?: HandleOptions) => request<T>("PUT", path, body, opts);
export const patchJson = <T>(path: string, body: unknown, opts?: HandleOptions) => request<T>("PATCH", path, body, opts);
export const deleteJson = <T>(path: string, body?: unknown, opts?: HandleOptions) => request<T>("DELETE", path, body, opts);
