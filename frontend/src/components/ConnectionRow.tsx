import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw, Trash2, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";

import { HoldingBadge } from "./HoldingBadge";
import { useManageConnection, useSyncConnection } from "../api/hooks";
import { connectionIssues, healthIssue } from "../lib/connectionHealth";
import { formatDate, formatRelative } from "../lib/date";
import { formatMoney } from "../lib/money";
import { colorForString } from "../lib/palette";
import type { SyncConnection } from "../api/types";

// Shared collapsible connection row used by the settings page and the sync
// modal. `onDelete` is optional — the delete icon renders only when provided
// (the sync modal omits it). `showProvider` hides the provider label in the
// subtext when rows are already grouped under provider headers (the modal).
export function ConnectionRow({
  conn,
  onDelete,
  showProvider = true,
}: {
  conn: SyncConnection & { providerName: string };
  onDelete?: () => void;
  showProvider?: boolean;
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
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left cursor-pointer hover:bg-surface-3 transition-colors duration-140"
      >
        <HoldingBadge
          logo={conn.logo}
          ticker={conn.displayName}
          color={conn.accounts[0]?.color}
          className="size-9 rounded-lg text-[13px]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-fg font-semibold text-[15px] truncate">
              {conn.displayName}
            </span>
            <StatusTag conn={conn} />
          </div>
          <p className="text-xs text-fg-faint mt-0.5">
            {showProvider && (
              <>
                {conn.providerName}
                <span className="mx-1.5">·</span>
              </>
            )}
            {t("settings.connections.accountsCount", { count: conn.accounts.length })}
            <span className="mx-1.5">·</span>
            {conn.lastSyncAt === null ? formatRelative(null) : t("settings.connections.synced", { date: formatRelative(conn.lastSyncAt) })}
          </p>
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
      {issues.length > 0 && !isPending && (
        <div className="mx-4 mb-3 rounded-xl border border-amber/20 bg-amber-soft px-3.5 py-3 text-[13px] leading-relaxed text-amber">
          {issues.map((issue, index) => (
            <p key={index}>
              {issue.accounts.length > 0 && `${issue.accounts.join(", ")}: `}
              {issue.kind === "error"
                ? issue.health.errorMessage || t(`settings.connections.health.states.${issue.health.state}`, { defaultValue: t("settings.connections.health.providerError", { state: issue.health.state }) })
                : issue.kind === "stale"
                  ? t("settings.connections.health.staleMessage", { date: formatDate(issue.health.lastUpdatedOn!) })
                  : t("settings.connections.health.unknownMessage")}
              {issue.health.nextRetryOn && `${issue.kind === "error" && issue.health.errorMessage && !/[.!?]$/.test(issue.health.errorMessage) ? "." : ""} ${t("settings.connections.health.retry", { date: formatDate(issue.health.nextRetryOn) })}`}
            </p>
          ))}
        </div>
      )}

      {open && (
        <div className="px-4 pb-3">
          {conn.accounts.length > 0 && (
          <div className="border-l border-surface-3 pl-4 ml-3.5">
            <ul className="flex flex-col divide-y divide-surface">
              {conn.accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                    <span
                      className="size-2.5 rounded-sm shrink-0"
                      style={{ background: a.color ?? colorForString(a.name) }}
                    />
                    <span className="text-sm text-fg-dim truncate">{a.name}</span>
                    <span className="text-[11px] rounded-md px-2 py-0.5 bg-surface-3 text-fg-faint shrink-0">
                      {a.typeLabel}
                    </span>
                    {a.health?.lastUpdatedOn && (
                      <span title={t("settings.connections.health.bankUpdated")} className={`text-[11px] whitespace-nowrap ${healthIssue(a.health) ? "text-amber" : "text-fg-faint"}`}>
                        <span className="mr-3">·</span>{formatDate(a.health.lastUpdatedOn)}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-fg font-mono shrink-0">
                    {formatMoney(a.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          )}

          {/* Phone: the header has no room for icon buttons, so the actions
              live here instead. */}
          <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-surface-3 pt-2.5 md:hidden">
            {conn.canManage && (
              <button type="button" onClick={stop(() => { void openManage(); })} disabled={manage.isPending || isSyncing || isPending}
                className="flex shrink-0 items-center gap-1.5 text-xs text-fg-dim disabled:opacity-40">
                <ExternalLink className="size-3.5" />{t("settings.connections.manage")}
              </button>
            )}
            <button
              type="button"
              onClick={stop(() => sync.mutate(conn.id))}
              disabled={isSyncing}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-fg-dim disabled:opacity-40"
            >
              <RefreshCw className={`size-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              {t("settings.connections.syncConnection")}
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={stop(onDelete)}
                className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-red"
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

  function StatusTag({ conn }: { conn: SyncConnection }) {
    const base = "text-[11px] rounded-md px-2 py-0.5 inline-flex items-center gap-1 shrink-0";
    if (isError) {
      return (
        <span className={`${base} bg-red/15 text-red`} title={conn.lastError ?? ""}>
          {conn.lastError ?? t("settings.connections.status.error")}
        </span>
      );
    }
    if (isSyncing) {
      return (
        <span className={`${base} bg-surface-3 text-fg-dim`}>
          <RefreshCw className="size-3 animate-spin" />
          {t(isAwaiting ? "settings.connections.status.awaiting" : "settings.connections.status.syncing")}
        </span>
      );
    }
    if (isPending) {
      return (
        <span className={`${base} bg-surface-3 text-fg-dim`}>
          {t("settings.connections.status.pending")}
        </span>
      );
    }
    if (issues.length > 0) {
      return <span className={`${base} bg-amber-soft text-amber`}>
        {t(partial ? "settings.connections.health.partial" : issues.every((i) => i.kind === "stale") ? "settings.connections.health.stale" : "settings.connections.health.attention")}
      </span>;
    }
    return (
      <span className={`${base} bg-green-soft text-green`}>
        {t("settings.connections.connectionConnected")}
      </span>
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
