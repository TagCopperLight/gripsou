// Failure injection, checked before any route: the faults states put in the
// store, and the panel's per-request overrides.

import type { Sent } from "./router.ts";

export type FaultMode = "loading" | "error" | "malformed";

/** The panel's modes: a state can also break a body. */
export type OverrideMode = Exclude<FaultMode, "malformed">;

export type Fault = {
  /** One method, or `write` for every method but GET. */
  method: string;
  /** A route pattern (`:id` matches any one segment); every path when left out. */
  path?: string;
  /** Paths spared. */
  except?: string[];
  mode: FaultMode;
};

/** A request as the panel lists it: `GET /accounts`. */
export function requestKey(method: string, path: string): string {
  return `${method} ${path}`;
}

function samePath(pattern: string, path: string): boolean {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  return a.length === b.length && a.every((p, i) => p.startsWith(":") || p === b[i]);
}

function matches(f: Fault, method: string, path: string): boolean {
  if (f.method === "write" ? method === "GET" : f.method !== method) return false;
  if (f.path !== undefined && !samePath(f.path, path)) return false;
  return !f.except?.includes(path);
}

/** The forced answer, "hold" to keep the request loading, or null to answer it. */
export function injected(faults: Fault[], overrides: Map<string, OverrideMode>, method: string, path: string): Sent | "hold" | null {
  const mode = overrides.get(requestKey(method, path)) ?? faults.find((f) => matches(f, method, path))?.mode;
  switch (mode) {
    case undefined:
      return null;
    case "loading":
      return "hold";
    case "error":
      return { status: 500, text: "forced by the review panel" };
    // A number where a list belongs: the pages reading it throw.
    case "malformed":
      return { status: 200, body: 42 };
  }
}
