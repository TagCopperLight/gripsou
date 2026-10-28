import type { AiStatus } from "../api/budget";

/** Which banner the Overview shows, in priority order. A run under way shows
 *  as a pill in the month line instead (`AiRunningPill`), and hides the last
 *  run's failure: a new run is answering it. `partial` is not a failure: a
 *  rate-limited run resumes on its own at the next sync. */
export function bannerVariant(s: AiStatus | undefined): "failed" | "review" | null {
  if (!s) return null;
  if (s.lastRun?.outcome === "error" && !s.running) return "failed";
  if (s.reviewCount > 0) return "review";
  return null;
}
