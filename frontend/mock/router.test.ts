import { describe, expect, it } from "vitest";
import { createRouter, reply } from "./router.ts";

describe("mock router", () => {
  it("extracts path params and answers 200 with a plain return", () => {
    const r = createRouter<null>();
    r.route("GET", "/holdings/:id/lots", ({ params }) => ({ id: params.id }));
    expect(r.dispatch(null, "GET", "/holdings/h1/lots", new URLSearchParams(), undefined)).toEqual({
      status: 200,
      body: { id: "h1" },
    });
  });

  it("passes a Reply through untouched", () => {
    const r = createRouter<null>();
    r.route("POST", "/auth/logout", () => reply(204));
    expect(r.dispatch(null, "POST", "/auth/logout", new URLSearchParams(), {})).toEqual({ status: 204 });
  });

  it("sends a plain body with a status field as a 200", () => {
    const r = createRouter<null>();
    r.route("GET", "/x", () => ({ status: 3 }));
    expect(r.dispatch(null, "GET", "/x", new URLSearchParams(), undefined)).toEqual({ status: 200, body: { status: 3 } });
  });

  it("matches the method", () => {
    const r = createRouter<null>();
    r.route("GET", "/accounts", () => []);
    expect(r.dispatch(null, "PATCH", "/accounts", new URLSearchParams(), {}).status).toBe(501);
  });

  it("answers 501 naming an unknown route", () => {
    const r = createRouter<null>();
    expect(r.dispatch(null, "GET", "/nope", new URLSearchParams(), undefined)).toEqual({
      status: 501,
      body: { unhandled: "GET /nope" },
    });
  });
});
