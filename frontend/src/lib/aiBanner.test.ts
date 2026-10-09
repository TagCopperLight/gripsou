import { describe, it, expect } from "vitest";
import { bannerVariant } from "./aiBanner";
import type { AiStatus } from "../api/budget";

const s = (over: Partial<AiStatus>): AiStatus => ({
  configured: true, running: false, remaining: 0, reviewCount: 0, lastRun: null, ...over,
});

describe("bannerVariant", () => {
  it("is nothing when there is nothing to do", () => expect(bannerVariant(s({}))).toBeNull());
  it("reports a failed last run first", () =>
    expect(bannerVariant(s({ reviewCount: 3, running: true, lastRun: { startedAt: "2026-10-09T00:00:00Z", outcome: "error", error: "x" } }))).toBe("failed"));
  it("does not treat partial as a failure", () =>
    expect(bannerVariant(s({ lastRun: { startedAt: "2026-10-09T00:00:00Z", outcome: "partial", error: "rate limited" } }))).toBeNull());
  it("prefers review over progress", () => expect(bannerVariant(s({ reviewCount: 2, running: true }))).toBe("review"));
  it("shows progress while running", () => expect(bannerVariant(s({ running: true, remaining: 40 }))).toBe("running"));
  it("is nothing while the status loads", () => expect(bannerVariant(undefined)).toBeNull());
});
