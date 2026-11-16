// The bearer token lives in localStorage (remembered) or sessionStorage (not), so the user stays signed in across refreshes.

import type { Body, Key, Params, Query, Res } from "./route";

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

// A saved token is checked at startup. Until then every other answer waits, so no page shows data
// before the user's prefs apply, or for a session the server refuses.
let releaseAnswers = () => {};
const sessionChecked: Promise<void> = authToken === null
  ? Promise.resolve()
  : new Promise((resolve) => { releaseAnswers = resolve; });

export function sessionCheckDone(): void {
  releaseAnswers();
}

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

/** A 401 to a request sent with the current token. Without a token it is just the answer; with an older one it is a previous session's late reply and must not sign out the new user. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

/** Carries the status so callers can branch on 409/404. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfter: number | null;
  constructor(message: string, status: number, retryAfter: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function handle(res: Response, path: string, method: string, requestToken: string | null): void {
  if (res.status === 401) {
    if (requestToken !== null && requestToken === authToken) onUnauthorized?.();
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

/** `undefined` for 204 and for a 202 that only says "started". */
async function bodyOf<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

type Options<K extends Key> = ([keyof Params<K>] extends [never] ? unknown : { params: Params<K> }) &
  (Body<K> extends undefined ? unknown : { body: Body<K> }) &
  (Query<K> extends undefined ? unknown : { query: Query<K> }) & { signal?: AbortSignal };

function pathOf(key: Key, params?: Record<string, string>, query?: object): string {
  const path = key
    .slice(key.indexOf(" ") + 1)
    .replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params?.[name] ?? ""));
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null) search.set(k, String(v));
  }
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function api<K extends Key>(
  key: K,
  ...[opts]: object extends Options<K> ? [opts?: Options<K>] : [opts: Options<K>]
): Promise<Res<K>> {
  const { params, query, signal, ...rest } = (opts ?? {}) as {
    params?: Record<string, string>;
    body?: unknown;
    query?: object;
    signal?: AbortSignal;
  };
  const method = key.slice(0, key.indexOf(" "));
  const body = rest.body ?? (method === "POST" ? {} : undefined);
  const path = pathOf(key, params, query);
  const requestToken = authToken;
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? authHeaders() : authHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  if (key !== "GET /auth/me") await sessionChecked;
  handle(res, path, method, requestToken);
  return bodyOf<Res<K>>(res);
}
