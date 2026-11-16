import type { Body, Key, Query, Res } from "../src/api/route.ts";
import { BadQuery, readQuery } from "./query.ts";

export type Sent = { status: number; body?: unknown } | { status: number; text: string };

const REPLY = Symbol("reply");

export type Reply<T> = { status: number; body?: T; [REPLY]: true };
export type Failure = { status: number; text: string; [REPLY]: true };

export function reply(status: number): Reply<void>;
export function reply<T>(status: number, body: T): Reply<T>;
export function reply<T>(status: number, body?: T): Reply<T | void> {
  return body === undefined ? { status, [REPLY]: true } : { status, body, [REPLY]: true };
}

export function fail(status: number, text: string): Failure {
  return { status, text, [REPLY]: true };
}

function isReply(v: unknown): v is Reply<unknown> | Failure {
  return typeof v === "object" && v !== null && REPLY in v;
}

export type Ctx<S, K extends Key> = {
  store: S;
  params: Record<string, string>;
  query: Query<K>;
  body: Body<K>;
};

export type Answer<R> = ([R] extends [void] ? never : R) | Reply<R> | Failure;

export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const parts = path.split("/").filter(Boolean);
  if (want.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const p = want[i];
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}

type Route<S> = { key: Key; method: string; pattern: string; handler: (ctx: Ctx<S, Key>) => unknown };

export function createRouter<S>() {
  const routes: Route<S>[] = [];

  function route<K extends Key>(key: K, handler: (ctx: Ctx<S, K>) => Answer<Res<K>>): void {
    const [method, pattern] = key.split(" ");
    routes.push({ key, method, pattern, handler: handler as Route<S>["handler"] });
  }

  function dispatch(store: S, method: string, path: string, query: URLSearchParams, body: unknown): Sent | null {
    for (const r of routes) {
      if (r.method !== method) continue;
      const params = matchPath(r.pattern, path);
      if (!params) continue;
      let typed: Query<Key>;
      try {
        typed = readQuery(r.key, query);
      } catch (e) {
        if (e instanceof BadQuery) return { status: 400, text: e.message };
        throw e;
      }
      const out = r.handler({ store, params, query: typed, body: body as Body<Key> });
      if (!isReply(out)) return { status: 200, body: out };
      if ("text" in out) return { status: out.status, text: out.text };
      return out.body === undefined ? { status: out.status } : { status: out.status, body: out.body };
    }
    return null;
  }

  const keys = (): Key[] => routes.map((r) => r.key);

  return { route, dispatch, keys };
}

export type Router<S> = ReturnType<typeof createRouter<S>>;
