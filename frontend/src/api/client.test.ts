// @vitest-environment jsdom
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { ApiError, api, getAuthToken, setAuthToken, setUnauthorizedHandler } from "./client";
import { stubFetch } from "../test/kit";

const LOGIN = { email: "a@example.com", password: "pw", remember: false };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setAuthToken(null);
});

test("remembered token persists to localStorage", () => {
  setAuthToken("tok", true);
  expect(getAuthToken()).toBe("tok");
  expect(localStorage.getItem("gripsou.token")).toBe("tok");
  expect(sessionStorage.getItem("gripsou.token")).toBeNull();
});

test("non-remembered token persists to sessionStorage", () => {
  setAuthToken("tok", false);
  expect(sessionStorage.getItem("gripsou.token")).toBe("tok");
  expect(localStorage.getItem("gripsou.token")).toBeNull();
});

test("clearing removes from both stores", () => {
  setAuthToken("tok", true);
  setAuthToken(null);
  expect(getAuthToken()).toBeNull();
  expect(localStorage.getItem("gripsou.token")).toBeNull();
  expect(sessionStorage.getItem("gripsou.token")).toBeNull();
});

describe("ApiError", () => {
  it("does not log out a new session when an old request returns 401", async () => {
    setAuthToken("old-token");
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    let release!: (response: Response) => void;
    stubFetch(() => new Promise<Response>((resolve) => { release = resolve; }));
    const request = api("GET /transactions", { query: {} }).catch((error: unknown) => error);
    setAuthToken("new-token");
    release(new Response("", { status: 401 }));
    expect(await request).toBeInstanceOf(ApiError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
  it("carries the status so callers can branch on 409 without parsing messages", async () => {
    stubFetch(async () => new Response("nope", { status: 409 }));
    const err = (await api("GET /budget/categories").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("GET /budget/categories failed: 409");
  });

  it("routes a 401 to the current session through the global handler", async () => {
    setAuthToken("tok");
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(async () => new Response("", { status: 401 }));
    const err = (await api("GET /budget/tags").catch((e: unknown) => e)) as ApiError;
    expect(onUnauthorized).toHaveBeenCalled();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });

  it("leaves a 401 to a request without a session to its caller", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    stubFetch(async () => new Response("", { status: 401 }));
    const err = (await api("POST /auth/login", { body: LOGIN }).catch((e: unknown) => e)) as ApiError;
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(err.status).toBe(401);
  });
});

describe("ApiError.retryAfter", () => {
  it("carries Retry-After seconds from a 429", async () => {
    stubFetch(async () => new Response("too many attempts", { status: 429, headers: { "Retry-After": "240" } }));
    const err = await api("POST /auth/login", { body: LOGIN }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
    expect((err as ApiError).retryAfter).toBe(240);
  });

  it("is null without the header", async () => {
    stubFetch(async () => new Response("x", { status: 500 }));
    const err = (await api("POST /auth/login", { body: LOGIN }).catch((e: unknown) => e)) as ApiError;
    expect(err.retryAfter).toBeNull();
  });
});

test("an empty success body reads as undefined for every verb", async () => {
  stubFetch(async () => new Response("", { status: 200 }));
  expect(await api("PUT /budget/categories/order", { body: { ids: [] } })).toBeUndefined();
  expect(await api("DELETE /auth/sessions")).toBeUndefined();
});
