import { describe, expect, it } from "vitest";
import { createControl } from "./control.ts";
import type { MockState } from "./states.ts";

const q = new URLSearchParams();

describe("review control", () => {
  it("fails an overridden request with a 500", () => {
    const c = createControl([]);
    c.setOverride("/accounts", "error");
    expect(c.handle("GET", "/accounts", q, undefined)).toMatchObject({ status: 500 });
    c.setOverride("/accounts", null);
    expect(c.handle("GET", "/accounts", q, undefined)).toMatchObject({ status: 200 });
  });

  it("holds a request kept loading until the override is cleared", () => {
    const c = createControl([]);
    c.setOverride("/accounts", "loading");
    expect(c.handle("GET", "/accounts", q, undefined)).toBe("hold");
  });

  it("re-applies active states on reset", () => {
    const rename: MockState = { id: "x", label: "x", pieces: [], apply: (s) => { s.user.name = "Renamed"; } };
    const c = createControl([rename]);
    c.setState("x", true);
    expect(c.store().user.name).toBe("Renamed");
    c.store().user.name = "Edited";
    c.reset();
    expect(c.store().user.name).toBe("Renamed");
    c.setState("x", false);
    expect(c.store().user.name).toBe("Camille Martin");
  });

  it("starts with the states active before a restart, and reports changes", () => {
    const rename: MockState = { id: "x", label: "x", pieces: [], apply: (s) => { s.user.name = "Renamed"; } };
    const seen: string[][] = [];
    const c = createControl([rename], { saved: { active: ["x", "gone"], app: null }, onChange: (s) => seen.push(s.active) });
    expect(c.store().user.name).toBe("Renamed");
    c.setState("x", false);
    expect(seen).toEqual([[]]);
  });

  it("records unknown routes", () => {
    const c = createControl([]);
    c.handle("GET", "/nope", q, undefined);
    expect(c.info().unhandled).toEqual(["GET /nope"]);
  });

  it("keeps the panel's language, currency and role through state changes and Reset", () => {
    const rename: MockState = { id: "x", label: "x", pieces: [], apply: (s) => { s.user.name = "Renamed"; } };
    const c = createControl([rename]);
    c.handle("PATCH", "/auth/prefs", q, { uiLanguage: "fr", currency: "USD" });
    c.setRole("user");
    c.setState("x", true);
    c.reset();
    expect(c.info().user).toEqual({ role: "user", uiLanguage: "fr", currency: "USD" });
  });

  it("turns the other states of a group off", () => {
    const a: MockState = { id: "a", label: "a", pieces: [], group: "g", apply: () => {} };
    const b: MockState = { id: "b", label: "b", pieces: [], group: "g", apply: () => {} };
    const c = createControl([a, b]);
    c.setState("a", true);
    c.setState("b", true);
    expect(c.info().states.filter((s) => s.active).map((s) => s.id)).toEqual(["b"]);
  });
});
