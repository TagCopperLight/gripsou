// Tiny method + path router for the review mode's fake API. A handler returns
// either `reply(status, body?)` or a plain value, sent as 200 JSON.

export type Reply = { status: number; body?: unknown };

export type Ctx<S> = {
  store: S;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
};

type Handler<S> = (ctx: Ctx<S>) => unknown;
type Route<S> = { method: string; parts: string[]; handler: Handler<S> };

const REPLY = Symbol("reply");

/** Wraps a status (and body) so the router doesn't mistake it for a 200 body. */
export function reply(status: number, body?: unknown): Reply {
  const r = body === undefined ? { status } : { status, body };
  return Object.defineProperty(r, REPLY, { value: true });
}

function isReply(v: unknown): v is Reply {
  return typeof v === "object" && v !== null && REPLY in v;
}

export function createRouter<S>() {
  const routes: Route<S>[] = [];

  function route(method: string, pattern: string, handler: Handler<S>): void {
    routes.push({ method, parts: pattern.split("/").filter(Boolean), handler });
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

  function dispatch(store: S, method: string, path: string, query: URLSearchParams, body: unknown): Reply {
    const parts = path.split("/").filter(Boolean);
    for (const r of routes) {
      if (r.method !== method) continue;
      const params = match(r, parts);
      if (!params) continue;
      const out = r.handler({ store, params, query, body });
      return isReply(out) ? { ...out } : { status: 200, body: out };
    }
    return { status: 501, body: { unhandled: `${method} ${path}` } };
  }

  return { route, dispatch };
}

export type Router<S> = ReturnType<typeof createRouter<S>>;
