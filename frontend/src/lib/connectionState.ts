import type { TFunction } from "i18next";
import type { ProviderGroup, SyncConnection, SyncHealth, ConnectionStatus } from "../api/wire";
import { formatDate, zonedDay } from "./date";
import { powensStateText } from "./powens";

export function flattenConnections(groups: ProviderGroup[] | undefined): SyncConnection[] {
  return (groups ?? []).flatMap((g) => g.connections);
}

/** A sync is in flight: the icon spins and the list polls fast. */
export function isSyncing(status: ConnectionStatus): boolean {
  return status === "syncing" || status === "awaiting";
}

/** A connection still being set up (or about to be deleted): listed, but not
 *  a bank yet. */
export function isPending(status: ConnectionStatus): boolean {
  return status === "pending";
}

/** No result to judge yet: a sync in flight, or a pending connection. */
function isUnsettled(status: ConnectionStatus): boolean {
  return isSyncing(status) || isPending(status);
}

export function anySyncing(groups: ProviderGroup[] | undefined): boolean {
  return flattenConnections(groups).some((c) => isSyncing(c.status));
}

/** Whether a sync finished between two reads of the list. Read per
 *  connection: one can finish while another runs, or start and finish
 *  between two reads (its `lastSyncAt` moved). */
export function syncFinished(prev: ProviderGroup[], next: ProviderGroup[]): boolean {
  const previous = new Map(flattenConnections(prev).map((c) => [c.id, c]));
  return flattenConnections(next).some((c) => {
    const before = previous.get(c.id);
    return (before !== undefined && isSyncing(before.status) && !isSyncing(c.status))
      || (c.lastSyncAt !== null && c.lastSyncAt !== before?.lastSyncAt);
  });
}

// A freshness warning is a heuristic, separate from confirmed provider errors.
// Allow three calendar days for weekends and slower bank connectors.
const STALE_AFTER_DAYS = 3;
export type HealthIssue = { kind: "error" | "stale" | "unknown"; health: SyncHealth; accounts: string[] };

export function healthIssue(health?: SyncHealth | null, today = zonedDay()): HealthIssue["kind"] | null {
  if (!health) return null; // Other providers and connections awaiting their first sync.
  if (health.state?.trim() || health.errorMessage?.trim()) return "error";
  if (!health.verified || !health.lastUpdatedOn) return "unknown";
  if ((Date.parse(today) - Date.parse(health.lastUpdatedOn)) / 86_400_000 > STALE_AFTER_DAYS) return "stale";
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

export type ConnectionAlert = "error" | "warning";

/** The dot on a connection's logo: red for a failed sync, amber for a health
 *  issue; none while there is no result to judge yet. */
export function connectionAlert(conn: SyncConnection, today = zonedDay()): ConnectionAlert | null {
  if (conn.status === "error") return "error";
  if (isUnsettled(conn.status)) return null;
  return connectionIssues(conn, today).length > 0 ? "warning" : null;
}

/** The dot on the global sync button: the worst of the connections' dots. */
export function overallAlert(groups: ProviderGroup[] | undefined, today = zonedDay()): ConnectionAlert | null {
  const alerts = flattenConnections(groups).map((c) => connectionAlert(c, today));
  return alerts.includes("error") ? "error" : alerts.includes("warning") ? "warning" : null;
}

/** The health line under a connection's name, when it has issues. */
export function issuesSummaryKey(conn: SyncConnection, issues: HealthIssue[]): string {
  const partial = conn.accounts.some((a) => !healthIssue(a.health)) && issues.some((i) => i.accounts.length > 0);
  if (partial) return "settings.connections.health.partial";
  if (issues.every((i) => i.kind === "stale")) return "settings.connections.health.stale";
  return "settings.connections.health.attention";
}

export type ConnectionProblem = {
  severity: ConnectionAlert;
  /** The accounts it concerns; none when it is about the whole connection. */
  accounts: string[];
  text: string;
  detail?: string;
  /** `detail` is a raw error (in English, often long). */
  technical?: boolean;
};

/** What is wrong with a connection, in words, one entry per problem. */
export function connectionProblems(
  conn: SyncConnection,
  issues: HealthIssue[],
  t: TFunction,
): ConnectionProblem[] {
  const problems: ConnectionProblem[] = [];
  if (conn.status === "error") {
    problems.push({ severity: "error", accounts: [], text: t("settings.connections.syncFailedMessage"), detail: conn.lastError ?? undefined, technical: true });
  }
  if (isPending(conn.status)) return problems;
  for (const issue of issues) {
    problems.push({
      severity: "warning",
      accounts: issue.accounts,
      text: issue.kind === "error"
        ? issue.health.errorMessage || powensStateText(t, issue.health.state)
        : issue.kind === "stale"
          ? t("settings.connections.health.staleMessage", { date: formatDate(issue.health.lastUpdatedOn!) })
          : t("settings.connections.health.unknownMessage"),
      detail: issue.health.nextRetryOn ? t("settings.connections.health.retry", { date: formatDate(issue.health.nextRetryOn) }) : undefined,
    });
  }
  return problems;
}

/** Why the net worth card has nothing to plot. */
export type NetWorthEmptyKind = "noConnection" | "syncing" | "nothingCameIn";

/** The server sends no points while the user has no accounts. Read off the
 *  connections: none yet, one still bringing its first accounts in, or
 *  connected but nothing gripsou can show (a failed first sync, or a bank
 *  holding only loans and cards, which are skipped). */
export function netWorthEmptyKind(groups: ProviderGroup[]): NetWorthEmptyKind {
  const conns = flattenConnections(groups);
  if (conns.length === 0) return "noConnection";
  if (conns.some((c) => isUnsettled(c.status))) return "syncing";
  return "nothingCameIn";
}
