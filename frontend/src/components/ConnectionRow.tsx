import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2, ChevronRight, ChevronDown, ExternalLink, CircleAlert, TriangleAlert } from "lucide-react";

import { HoldingBadge } from "./HoldingBadge";
import { useManageConnection, useSyncConnection } from "../api/hooks";
import { connectionIssues, healthIssue } from "../lib/connectionHealth";
import { formatDate, formatRelative } from "../lib/date";
import { formatMoney } from "../lib/money";
import { accountTypeLabel, type SyncConnection } from "../api/types";

// Shared collapsible connection row used by the settings page and the sync
// modal. `onDelete` is optional — the delete icon renders only when provided
// (the sync modal omits it).
export function ConnectionRow({
  conn,
  onDelete,
}: {
  conn: SyncConnection;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sync = useSyncConnection();
  const manage = useManageConnection();
  const [manageError, setManageError] = useState<string | null>(null);
  const returnListener = useRef<(() => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (returnListener.current) window.removeEventListener("focus", returnListener.current);
    };
  }, []);
  const openManage = async () => {
    setManageError(null);
    // Open synchronously during the click so browsers do not block the tab.
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setManageError(t("settings.connections.manageBlocked")); return; }
    tab.opener = null;
    try {
      const { redirectUrl } = await manage.mutateAsync(conn.id);
      if (!mounted.current) { tab.close(); return; }
      tab.location.href = redirectUrl;
      if (returnListener.current) window.removeEventListener("focus", returnListener.current);
      const onReturn = () => {
        returnListener.current = null;
        // Import whatever the user refreshed in Powens when they return.
        sync.mutate(conn.id);
      };
      returnListener.current = onReturn;
      window.addEventListener("focus", onReturn, { once: true });
    } catch {
      tab.close();
      if (mounted.current) setManageError(t("settings.connections.manageFailed"));
    }
  };
  const issues = connectionIssues(conn);
  const partial = conn.accounts.some((a) => !healthIssue(a.health)) && issues.some((i) => i.accounts.length > 0);

  type Problem = { severity: "error" | "warning"; accounts: string[]; text: string; detail?: string; technical?: boolean };
  const problems: Problem[] = [];
  if (conn.status === "error") {
    problems.push({ severity: "error", accounts: [], text: t("settings.connections.syncFailedMessage"), detail: conn.lastError ?? undefined, technical: true });
  }
  if (conn.status !== "pending") {
    for (const issue of issues) {
      problems.push({
        severity: "warning",
        accounts: issue.accounts,
        text: issue.kind === "error"
          ? issue.health.errorMessage || t(`settings.connections.health.states.${issue.health.state}`, { defaultValue: t("settings.connections.health.providerError", { state: issue.health.state }) })
          : issue.kind === "stale"
            ? t("settings.connections.health.staleMessage", { date: formatDate(issue.health.lastUpdatedOn!) })
            : t("settings.connections.health.unknownMessage"),
        detail: issue.health.nextRetryOn ? t("settings.connections.health.retry", { date: formatDate(issue.health.nextRetryOn) }) : undefined,
      });
    }
  }

  const isAwaiting = conn.status === "awaiting";
  const isSyncing = conn.status === "syncing" || isAwaiting;
  const isError = conn.status === "error";
  const isPending = conn.status === "pending";

  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="bg-surface-2 rounded-2xl overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        className="group w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-surface-3 transition-colors duration-140"
      >
        <span className="relative shrink-0">
          <HoldingBadge
            logo={conn.logo}
            ticker={conn.displayName}
            color={conn.accounts[0]?.color}
            className="size-9 rounded-lg text-[13px]"
          />
          {(isError || (issues.length > 0 && !isSyncing && !isPending)) && (
            <span
              data-testid={isError ? "connection-error-dot" : "connection-warning-dot"}
              className={`absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-surface-2 group-hover:ring-surface-3 transition-colors duration-140 ${isError ? "bg-red" : "bg-amber"}`}
            />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-fg font-semibold text-[15px] truncate">
            {conn.displayName}
          </span>
          <Summary />
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="hidden items-center gap-1.5 md:flex">
          {conn.canManage && (
            <IconButton
              onClick={stop(() => { void openManage(); })}
              aria-label={t("settings.connections.manage")}
              title={t("settings.connections.manage")}
              disabled={manage.isPending || isSyncing || isPending}
            >
              <ExternalLink className="size-4" />
            </IconButton>
          )}
          <IconButton
            onClick={stop(() => sync.mutate(conn.id))}
            aria-label={t("settings.connections.syncConnection")}
            disabled={isSyncing}
          >
            <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
          </IconButton>
          {onDelete && (
            <IconButton
              onClick={stop(onDelete)}
              aria-label={t("settings.connections.deleteConnection")}
              danger
            >
              <Trash2 className="size-4" />
            </IconButton>
          )}
          </div>
          {open ? (
            <ChevronDown className="size-4 text-fg-faint" />
          ) : (
            <ChevronRight className="size-4 text-fg-faint" />
          )}
        </div>
      </div>

      {manageError && <p role="alert" className="px-4 pb-3 text-xs text-red">{manageError}</p>}
      {open && (
        <div className="px-4 pb-3">
          {conn.accounts.length > 0 && (
          <div className="border-l border-surface-3 pl-4 ml-3.5">
            {/* A table without a header: the account and its type tag on the
                left; the bank date and the amount packed together on the right.
                The amount column has a minimum width, so the dates line up from
                one bank to the next. */}
            <ul className="grid grid-cols-[minmax(0,1fr)_auto_minmax(6.5rem,auto)] divide-y divide-surface-3">
              {conn.accounts.map((a) => (
                <li
                  key={a.id}
                  className="col-span-3 grid grid-cols-subgrid items-center py-2.5 first:pt-1 last:pb-1"
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-4">
                    <span
                      className="size-2.5 rounded-sm shrink-0"
                      style={{ background: a.color }}
                    />
                    <span className="text-sm text-fg-dim truncate">{a.name}</span>
                    <span className="text-[11px] rounded-md px-2 py-0.5 bg-surface-3 text-fg-faint whitespace-nowrap shrink-0">
                      {accountTypeLabel(t, a.typeKey)}
                    </span>
                  </div>
                  <span title={t("settings.connections.health.bankUpdated")} className={`pl-3 pr-2 text-right text-[11px] whitespace-nowrap ${healthIssue(a.health) ? "text-amber" : "text-fg-faint"}`}>
                    {a.health?.lastUpdatedOn && formatDate(a.health.lastUpdatedOn)}
                  </span>
                  <span className="text-right text-sm text-fg font-mono">
                    {formatMoney(a.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          )}

          {/* What is wrong, in words: a line per problem under the accounts,
              the account it concerns named first, details in faint text. */}
          {problems.length > 0 && (
            <div className={`flex flex-col gap-2.5 ${conn.accounts.length > 0 ? "mt-3" : ""}`}>
              {problems.map((p, index) => (
                <div key={index} className="flex items-center gap-2.5 text-[13px] leading-relaxed text-fg-dim">
                  {p.severity === "error"
                    ? <CircleAlert className="size-3.5 shrink-0 text-red" />
                    : <TriangleAlert className="size-3.5 shrink-0 text-amber" />}
                  <div className="min-w-0 flex-1">
                    {/* Always one line: a long account name is cut, never the message. */}
                    <p className="flex min-w-0 whitespace-nowrap">
                      {p.accounts.length > 0 && (
                        <span className="min-w-0 truncate font-medium text-fg">{p.accounts.join(", ")}:&nbsp;</span>
                      )}
                      <span className="shrink-0">{p.text}</span>
                    </p>
                    {p.detail && <p className={`text-fg-faint ${p.technical ? "font-mono text-[11px] break-words" : "text-xs"}`}>{p.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Phone: the header has no room for icon buttons, so the actions
              live here instead. */}
          <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-surface-3 pt-2.5 md:hidden">
            {conn.canManage && (
              <button type="button" onClick={stop(() => { void openManage(); })} disabled={manage.isPending || isSyncing || isPending}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-dim disabled:opacity-40 disabled:cursor-not-allowed">
                <ExternalLink className="size-3.5" />{t("settings.connections.manage")}
              </button>
            )}
            <button
              type="button"
              onClick={stop(() => sync.mutate(conn.id))}
              disabled={isSyncing}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-fg-dim disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              {t("settings.connections.syncConnection")}
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={stop(onDelete)}
                className="ml-auto flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-red"
              >
                <Trash2 className="size-3.5" />
                {t("settings.connections.deleteConnection")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );

  // One line under the name: the state in words, in colour when something is
  // wrong (the dot on the logo says so too); the sync time when all is well.
  function Summary() {
    const line = "mt-0.5 text-xs truncate";
    if (isError) {
      return (
        <p className={`${line} text-red`} title={conn.lastError ?? undefined}>
          {t("settings.connections.status.error")}
        </p>
      );
    }
    if (isSyncing || isPending) {
      return (
        <p className={`${line} text-fg-dim`}>
          {t(isAwaiting ? "settings.connections.status.awaiting" : isPending ? "settings.connections.status.pending" : "settings.connections.status.syncing")}
        </p>
      );
    }
    if (issues.length > 0) {
      return (
        <p className={`${line} text-amber`}>
          {t(partial ? "settings.connections.health.partial" : issues.every((i) => i.kind === "stale") ? "settings.connections.health.stale" : "settings.connections.health.attention")}
        </p>
      );
    }
    return (
      <p className={`${line} text-fg-faint`}>
        {conn.lastSyncAt === null ? formatRelative(null) : t("settings.connections.synced", { date: formatRelative(conn.lastSyncAt) })}
      </p>
    );
  }
}

function IconButton({
  danger = false,
  className = "",
  ...props
}: ComponentPropsWithoutRef<"button"> & { danger?: boolean }) {
  return (
    <button
      type="button"
      className={`size-8 rounded-lg flex items-center justify-center cursor-pointer text-fg-faint transition-colors duration-140 hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed ${
        danger ? "hover:text-red" : "hover:text-fg"
      } ${className}`}
      {...props}
    />
  );
}
