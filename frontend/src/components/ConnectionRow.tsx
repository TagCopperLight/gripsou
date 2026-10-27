import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { showError, useErrorToast } from "../lib/errorToasts";
import { RefreshCw, Trash2, ChevronRight, ChevronDown, ExternalLink, CircleAlert, TriangleAlert } from "lucide-react";

import { HoldingBadge } from "./HoldingBadge";
import { useManageConnection, useSyncConnection } from "../api/hooks";
import { AlertDot } from "./AlertDot";
import { connectionAlert, connectionIssues, healthIssue } from "../lib/connectionHealth";
import { formatDate, formatRelative } from "../lib/date";
import { formatMoney } from "../lib/money";
import type { SyncConnection } from "../api/types";

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
  useErrorToast(sync.isError && t("sync.startFailed"));
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
      showError(t("settings.connections.manageFailed"));
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
  // Nothing to show once open (still connecting, or no account and no
  // problem): the row doesn't open on a computer. A phone still opens it, as
  // its open panel holds the actions the header has no room for.
  const expandable = conn.status !== "pending" && (conn.accounts.length > 0 || problems.length > 0);
  const toggle = () => {
    if (!expandable && window.matchMedia?.("(min-width: 48rem)").matches) return;
    setOpen((o) => !o);
  };
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
        aria-disabled={!expandable || undefined}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggle();
          }
        }}
        className={`group w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-surface-3 transition-colors duration-140 ${expandable ? "" : "md:cursor-default md:hover:bg-transparent"}`}
      >
        <span className="relative shrink-0">
          <HoldingBadge
            logo={conn.logo}
            ticker={conn.displayName}
            color={conn.accounts[0]?.color}
            className="size-9 rounded-lg text-[13px]"
          />
          <AlertDot alert={connectionAlert(conn)} className="ring-surface-2 group-hover:ring-surface-3" />
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
            <ChevronRight className={`size-4 text-fg-faint ${expandable ? "" : "md:opacity-30"}`} />
          )}
        </div>
      </div>

      {manageError && <p role="alert" className="px-4 pb-3 text-xs text-red">{manageError}</p>}
      {open && (
        <div className="px-4 pb-3">
          {conn.accounts.length > 0 && (
          <div className="border-l border-surface-3 pl-4 ml-2.25">
            {/* A table without a header: the account on the left; the bank
                date and the amount packed together on the right. The amount
                column has a minimum width, so the dates line up from one bank
                to the next. */}
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
                    <span className="text-[13px] text-fg truncate">{a.name}</span>
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
                <div key={index} className="flex items-center gap-3 text-[13px] leading-relaxed text-fg-dim">
                  {/* The app's usual icon size (16px), between the old 14px and the banners' 20px. */}
                  {p.severity === "error"
                    ? <CircleAlert className="size-4 shrink-0 text-red" aria-hidden />
                    : <TriangleAlert className="size-4 shrink-0 text-amber" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    {/* Always one line: a long account name is cut, never the message. */}
                    <p className="flex min-w-0 whitespace-nowrap">
                      {p.accounts.length > 0 && (
                        <>
                          <span className="min-w-0 truncate font-medium text-fg">{p.accounts.join(", ")}</span>
                          {/* Outside the cut name, so it survives the cut: ": " in English, " : " in French. */}
                          <span className="shrink-0 whitespace-pre font-medium text-fg">{t("settings.connections.problemSeparator")}</span>
                        </>
                      )}
                      <span className="shrink-0">{p.text}</span>
                    </p>
                    {/* A technical error (in English, often long) stays on one line, whole on hover. */}
                    {p.detail && (
                      <p className={`text-fg-faint ${p.technical ? "truncate font-mono text-[11px]" : "text-xs"}`} title={p.technical ? p.detail : undefined}>
                        {p.detail}
                      </p>
                    )}
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
        {conn.lastSyncAt === null ? t("settings.connections.neverSynced") : t("settings.connections.synced", { date: formatRelative(conn.lastSyncAt) })}
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
      // Disabled: faded like a row's caret when it can't open, and it lets the
      // pointer through to the row, so the cursor doesn't change and a click
      // opens or closes the row like anywhere else on it.
      className={`size-8 rounded-lg flex items-center justify-center cursor-pointer text-fg-faint transition-colors duration-140 enabled:hover:bg-surface-2 disabled:opacity-30 disabled:pointer-events-none ${
        danger ? "enabled:hover:text-red" : "enabled:hover:text-fg"
      } ${className}`}
      {...props}
    />
  );
}
