import { describe, it, expect } from "vitest";
import { bannerVariant } from "./aiBanner";
import type { AiStatus } from "../api/budget";

const s = (over: Partial<AiStatus>): AiStatus => ({
  configured: true, enabled: true, running: false, remaining: 0, reviewCount: 0, threshold: 80, lastRun: null, ...over,
});

describe("bannerVariant", () => {
  it("is nothing when there is nothing to do", () => expect(bannerVariant(s({}))).toBeNull());
  it("reports a failed last run first", () =>
    expect(bannerVariant(s({ reviewCount: 3, running: true, lastRun: { outcome: "error", error: "x", at: 0 } }))).toBe("failed"));
  it("does not treat partial as a failure", () =>
    expect(bannerVariant(s({ lastRun: { outcome: "partial", error: "rate limited", at: 0 } }))).toBeNull());
  it("prefers review over progress", () => expect(bannerVariant(s({ reviewCount: 2, running: true }))).toBe("review"));
  it("shows progress while running", () => expect(bannerVariant(s({ running: true, remaining: 40 }))).toBe("running"));
  it("is nothing while the status loads", () => expect(bannerVariant(undefined)).toBeNull());
});
