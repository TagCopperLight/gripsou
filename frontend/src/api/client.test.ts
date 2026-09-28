// @vitest-environment jsdom
import { beforeEach, describe, expect, it, test, vi } from "vitest";
import { ApiError, getAuthToken, getJson, setAuthToken, setUnauthorizedHandler } from "./client";

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
  it("carries the status so callers can branch on 409 without parsing messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 409 })));
    const err = (await getJson("/budget/categories").catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toBe("GET /budget/categories failed: 409");
  });

  it("still routes 401 through the global handler", async () => {
    const onUnauthorized = vi.fn();
    setUnauthorizedHandler(onUnauthorized);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    const err = (await getJson("/budget/tags").catch((e: unknown) => e)) as ApiError;
    expect(onUnauthorized).toHaveBeenCalled();
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
  });
});
