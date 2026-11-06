import { describe, it, expect } from "vitest";
import { ApiError } from "../api/client";
import { throttleMinutes } from "./throttle";

describe("throttleMinutes", () => {
  it("rounds Retry-After up to whole minutes, at least one", () => {
    expect(throttleMinutes(new ApiError("x", 429, 61))).toBe(2);
    expect(throttleMinutes(new ApiError("x", 429, 5))).toBe(1);
    expect(throttleMinutes(new ApiError("x", 429, null))).toBe(1);
  });
  it("ignores other errors", () => {
    expect(throttleMinutes(new ApiError("x", 400))).toBeNull();
    expect(throttleMinutes(new Error("x"))).toBeNull();
  });
});
