import { describe, expect, it } from "vitest";
import { createRouter, fail, reply } from "./router.ts";

const q = new URLSearchParams();

describe("mock router", () => {
  it("extracts path params and answers 200 with a plain return", () => {
    const r = createRouter<null>();
    r.route("GET /auth/token/:token", ({ params }) => ({ type: "invite", email: params.token }));
    expect(r.dispatch(null, "GET", "/auth/token/a%40b", q, undefined)).toEqual({ status: 200, body: { type: "invite", email: "a@b" } });
  });

  it("passes a reply's status through", () => {
    const r = createRouter<null>();
    r.route("POST /auth/logout", () => reply(204));
    expect(r.dispatch(null, "POST", "/auth/logout", q, {})).toEqual({ status: 204 });
  });

  it("sends a failure as text, as the server does", () => {
    const r = createRouter<null>();
    r.route("GET /accounts", () => fail(404, "nope"));
    expect(r.dispatch(null, "GET", "/accounts", q, undefined)).toEqual({ status: 404, text: "nope" });
  });

  it("sends a plain body with a status field as a 200", () => {
    const r = createRouter<null>();
    r.route("GET /health", () => ({ status: "ok", version: "x" }));
    expect(r.dispatch(null, "GET", "/health", q, undefined)).toEqual({ status: 200, body: { status: "ok", version: "x" } });
  });

  it("matches the method", () => {
    const r = createRouter<null>();
    r.route("GET /accounts", () => []);
    expect(r.dispatch(null, "PATCH", "/accounts", q, {})).toBeNull();
  });
});
