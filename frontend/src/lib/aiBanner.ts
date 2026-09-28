import type { AiStatus } from "../api/budget";

/** Which banner the Overview shows, in priority order. `partial` is not
 *  a failure: a rate-limited run resumes on its own at the next sync. */
export function bannerVariant(s: AiStatus | undefined): "failed" | "review" | "running" | null {
  if (!s) return null;
  if (s.lastRun?.outcome === "error") return "failed";
  if (s.reviewCount > 0) return "review";
  if (s.running) return "running";
  return null;
}
