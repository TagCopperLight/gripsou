import { describe, expect, it } from "vitest";
import { createControl } from "./control";
import type { MockState } from "./states";

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
    const rename: MockState = { id: "x", label: "x", route: "/", apply: (s) => { s.user.name = "Renamed"; } };
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
    const rename: MockState = { id: "x", label: "x", route: "/", apply: (s) => { s.user.name = "Renamed"; } };
    const seen: string[][] = [];
    const c = createControl([rename], ["x", "gone"], (a) => seen.push(a));
    expect(c.store().user.name).toBe("Renamed");
    c.setState("x", false);
    expect(seen).toEqual([[]]);
  });

  it("records unknown routes", () => {
    const c = createControl([]);
    c.handle("GET", "/nope", q, undefined);
    expect(c.info().unhandled).toEqual(["GET /nope"]);
  });
});
