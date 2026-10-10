import type { SyncConnection, SyncHealth } from "../api/types";
import { zonedDay } from "./date";

// A freshness warning is a heuristic, separate from confirmed provider errors.
// Allow three calendar days for weekends and slower bank connectors.
export const STALE_AFTER_DAYS = 3;
export type HealthIssue = { kind: "error" | "stale" | "unknown"; health: SyncHealth; accounts: string[] };

export function healthIssue(health?: SyncHealth | null, today = zonedDay()): HealthIssue["kind"] | null {
  if (!health) return null; // Other providers and connections awaiting their first sync.
  if (health.state?.trim() || health.errorMessage?.trim()) return "error";
  if (!health.verified || !health.lastUpdatedOn) return "unknown";
  if (health.lastUpdatedOn && (Date.parse(today) - Date.parse(health.lastUpdatedOn)) / 86_400_000 > STALE_AFTER_DAYS) return "stale";
  return null;
}

export function connectionIssues(conn: SyncConnection, today = zonedDay()): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const add = (health: SyncHealth | null | undefined, account?: string) => {
    const kind = healthIssue(health, today);
    if (!kind || !health) return;
    const existing = issues.find((i) => i.kind === kind && JSON.stringify(i.health) === JSON.stringify(health));
    if (existing) { if (account) existing.accounts.push(account); }
    else issues.push({ kind, health, accounts: account ? [account] : [] });
  };
  for (const account of conn.accounts) add(account.health, account.name);
  // Account timestamps take precedence over a parent's aggregate timestamp.
  if (conn.health && (healthIssue(conn.health, today) !== "stale" || !conn.accounts.length)) {
    const duplicate = issues.some((i) => i.health.state === conn.health?.state && i.health.errorMessage === conn.health?.errorMessage);
    if (!duplicate) add(conn.health);
  }
  return issues;
}
