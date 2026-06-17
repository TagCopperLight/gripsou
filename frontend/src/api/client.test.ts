// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { getAuthToken, setAuthToken } from "./client";

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
