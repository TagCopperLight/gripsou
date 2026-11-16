import type { AiStatus } from "../api/wire";

/** A run under way shows as a pill instead and hides the last run's failure. `partial` is not a failure: a rate-limited run resumes at the next sync. */
export function bannerVariant(s: AiStatus | undefined): "failed" | "review" | null {
  if (!s) return null;
  if (s.lastRun?.outcome === "error" && !s.running) return "failed";
  if (s.reviewCount > 0) return "review";
  return null;
}
