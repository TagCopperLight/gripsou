// Method + path router for the review mode's fake API, typed by the contract
// (contract.ts): a handler gets its route's request body and must answer its
// response type. It returns the body (sent as 200 JSON), `reply(status, body?)`
// for another status, or `fail(status, message)` for an error.

import type { Body, Key, Res } from "./contract.ts";

/** What the plugin sends: JSON (or nothing), or an error as plain text, as the server does. */
export type Sent = { status: number; body?: unknown } | { status: number; text: string };

const REPLY = Symbol("reply");

export type Reply<T> = { status: number; body?: T; [REPLY]: true };
export type Failure = { status: number; text: string; [REPLY]: true };

/** Wraps a status (and body) so the router doesn't mistake it for a 200 body. */
export function reply(status: number): Reply<void>;
export function reply<T>(status: number, body: T): Reply<T>;
export function reply<T>(status: number, body?: T): Reply<T | void> {
  return body === undefined ? { status, [REPLY]: true } : { status, body, [REPLY]: true };
}

/** An error answer: the server's errors are a plain-text message. */
export function fail(status: number, text: string): Failure {
  return { status, text, [REPLY]: true };
}

function isReply(v: unknown): v is Reply<unknown> | Failure {
  return typeof v === "object" && v !== null && REPLY in v;
}

export type Ctx<S, B> = {
  store: S;
  params: Record<string, string>;
  query: URLSearchParams;
  body: B;
};

/** A route with no response body answers with a status only (`reply(204)`). */
export type Answer<R> = ([R] extends [void] ? never : R) | Reply<R> | Failure;

type Route<S> = { key: Key; method: string; parts: string[]; handler: (ctx: Ctx<S, unknown>) => unknown };

export function createRouter<S>() {
  const routes: Route<S>[] = [];

  function route<K extends Key>(key: K, handler: (ctx: Ctx<S, Body<K>>) => Answer<Res<K>>): void {
    const [method, pattern] = key.split(" ");
    routes.push({ key, method, parts: pattern.split("/").filter(Boolean), handler: handler as Route<S>["handler"] });
  }

  function match(r: Route<S>, parts: string[]): Record<string, string> | null {
    if (r.parts.length !== parts.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < parts.length; i++) {
      const p = r.parts[i];
      if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(parts[i]);
      else if (p !== parts[i]) return null;
    }
    return params;
  }

  /** The answer, or null when no route matches. */
  function dispatch(store: S, method: string, path: string, query: URLSearchParams, body: unknown): Sent | null {
    const parts = path.split("/").filter(Boolean);
    for (const r of routes) {
      if (r.method !== method) continue;
      const params = match(r, parts);
      if (!params) continue;
      const out = r.handler({ store, params, query, body });
      if (!isReply(out)) return { status: 200, body: out };
      if ("text" in out) return { status: out.status, text: out.text };
      return out.body === undefined ? { status: out.status } : { status: out.status, body: out.body };
    }
    return null;
  }

  /** Every route registered, as the contract names it. */
  const keys = (): Key[] => routes.map((r) => r.key);

  return { route, dispatch, keys };
}

export type Router<S> = ReturnType<typeof createRouter<S>>;
