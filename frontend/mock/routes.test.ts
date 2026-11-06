import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/api/routes.ts";
import type { Account, Holding } from "../src/api/wire.ts";
import { NOT_MOCKED } from "./contract.ts";
import { CW8 } from "./data/base.ts";
import { router } from "./routes/index.ts";
import { createStore } from "./store.ts";

/** A value for each path parameter of a server GET, and the queries it requires. */
const PARAMS: Record<string, string> = { id: CW8, token: "abc", provider: "jev" };
const QUERIES: Record<string, Record<string, string>> = { "/budget/trend": { anchor: "2026-09" } };

const body = <T,>(path: string, query: Record<string, string> = {}): T => {
  const out = router.dispatch(createStore(), "GET", path, new URLSearchParams(query), undefined);
  if (!out || !("body" in out)) throw new Error(`GET ${path}: ${JSON.stringify(out)}`);
  return out.body as T;
};

describe("the mock against the server's routes", () => {
  it("handles every server route but the listed ones, and no other", () => {
    const skipped: readonly string[] = NOT_MOCKED;
    expect([...router.keys()].sort()).toEqual(ROUTES.filter((r) => !skipped.includes(r)).sort());
  });

  const gets = ROUTES.filter((r) => r.startsWith("GET ")).map((r) => r.slice(4));
  it.each(gets)("answers GET %s from the base dataset", (pattern) => {
    const path = pattern.replace(/:(\w+)/g, (_, name: string) => PARAMS[name]);
    const out = router.dispatch(createStore(), "GET", path, new URLSearchParams(QUERIES[pattern]), undefined);
    expect(out?.status).toBe(200);
  });
});

describe("base dataset", () => {
  it("values the PEA from its lots and cash", () => {
    const accounts = body<Account[]>("/accounts");
    const holdings = body<Holding[]>("/holdings");
    for (const a of accounts) {
      const sum = holdings.filter((h) => h.accountId === a.id).reduce((s, h) => s + Number(h.value), 0);
      expect(Number(a.value)).toBeCloseTo(sum, 1);
    }
  });

  it("pages the transaction list", () => {
    const page = (offset: number) => body<unknown[]>("/transactions", { limit: "200", offset: String(offset) });
    expect(page(0)).toHaveLength(200);
    expect(page(200).length).toBeGreaterThan(0);
  });
});
