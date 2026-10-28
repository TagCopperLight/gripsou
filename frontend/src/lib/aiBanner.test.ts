import { describe, it, expect } from "vitest";
import { bannerVariant } from "./aiBanner";
import type { AiStatus } from "../api/budget";

const s = (over: Partial<AiStatus>): AiStatus => ({
  configured: true, running: false, remaining: 0, reviewCount: 0, lastRun: null, ...over,
});

describe("bannerVariant", () => {
  it("is nothing when there is nothing to do", () => expect(bannerVariant(s({}))).toBeNull());
  it("reports a failed last run first", () =>
    expect(bannerVariant(s({ reviewCount: 3, lastRun: { startedAt: "2026-10-09T00:00:00Z", outcome: "error", error: "x" } }))).toBe("failed"));
  it("drops the failure once a new run is under way", () =>
    expect(bannerVariant(s({ running: true, lastRun: { startedAt: "2026-10-09T00:00:00Z", outcome: "error", error: "x" } }))).toBeNull());
  it("does not treat partial as a failure", () =>
    expect(bannerVariant(s({ lastRun: { startedAt: "2026-10-09T00:00:00Z", outcome: "partial", error: "rate limited" } }))).toBeNull());
  it("keeps the review banner while a run is under way", () => expect(bannerVariant(s({ reviewCount: 2, running: true }))).toBe("review"));
  it("is nothing while the status loads", () => expect(bannerVariant(undefined)).toBeNull());
});
