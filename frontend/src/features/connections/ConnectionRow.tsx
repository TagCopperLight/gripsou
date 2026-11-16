import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { FieldError } from "../../ui/FieldError";
import { showError, useErrorToast } from "../../lib/errorToasts";
import { RefreshCw, Trash2, ChevronRight, ChevronDown, ExternalLink, CircleAlert, TriangleAlert } from "lucide-react";

import { HoldingBadge } from "../../ui/HoldingBadge";
import { useManageConnection, useSyncAllPending, useSyncConnection } from "../../api/connections";
import { AlertDot } from "./AlertDot";
import {
  connectionAlert,
  connectionIssues,
  connectionProblems,
  healthIssue,
  isSyncing,
  issuesSummaryKey,
} from "../../lib/connectionState";
import { formatDate, formatRelative } from "../../lib/date";
import { formatMoney } from "../../lib/money";
import { FxAsterisk, FxFootnote } from "../../ui/FxNote";
import { Bone, Skeleton, TextBone } from "../../ui/Skeleton";
import { IconButton } from "../../ui/IconButton";
import type { SyncConnection } from "../../api/wire";

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
  const syncAllPending = useSyncAllPending();
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
    // Opened synchronously during the click so browsers don't block the tab.
    const tab = window.open("about:blank", "_blank");
    if (!tab) { setManageError(t("powens.manageBlocked")); return; }
    tab.opener = null;
    try {
      const { redirectUrl } = await manage.mutateAsync(conn.id);
      if (!redirectUrl) throw new Error("no management link");
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
      showError(t("powens.manageFailed"));
    }
  };
  const issues = connectionIssues(conn);
  const problems = connectionProblems(conn, issues, t);

  const isAwaiting = conn.status === "awaiting";
  // A phone still opens the row: its panel holds the actions the header has no room for.
  const expandable = conn.status !== "pending" && (conn.accounts.length > 0 || problems.length > 0);
  const toggle = () => {
    if (!expandable && window.matchMedia?.("(min-width: 48rem)").matches) return;
    setOpen((o) => !o);
  };
  const syncing = isSyncing(conn.status);
  // The icon spins from the click on, not only once the server says so.
  const syncSpins = syncing || sync.isPending || syncAllPending;
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
              disabled={manage.isPending || syncing || isPending}
            >
              <ExternalLink className="size-4" />
            </IconButton>
          )}
          <IconButton
            onClick={stop(() => sync.mutate(conn.id))}
            aria-label={t("settings.connections.syncConnection")}
            disabled={syncSpins}
          >
            <RefreshCw className={`size-4 ${syncSpins ? "animate-spin" : ""}`} />
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

      {manageError && (
        <div className="px-4 pb-3">
          <FieldError>{manageError}</FieldError>
        </div>
      )}
      {open && (
        <div className="px-4 pb-3">
          {conn.accounts.length > 0 && (
          <div className="border-l border-surface-3 pl-4 ml-2.25">
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
                  <span className="relative text-right text-sm text-fg font-mono">
                    {a.value === null ? "—" : formatMoney(a.value)}
                    {a.value === null && <FxAsterisk />}
                  </span>
                </li>
              ))}
            </ul>
            {conn.accounts.some((a) => a.value === null) && (
              <FxFootnote className="mt-2">{t("fx.excludesSome")}</FxFootnote>
            )}
          </div>
          )}

          {problems.length > 0 && (
            <div className={`flex flex-col gap-2.5 ${conn.accounts.length > 0 ? "mt-3" : ""}`}>
              {problems.map((p, index) => (
                <div key={index} className="flex items-center gap-3 text-[13px] leading-relaxed text-fg-dim">
                  {p.severity === "error"
                    ? <CircleAlert className="size-4 shrink-0 text-red" aria-hidden />
                    : <TriangleAlert className="size-4 shrink-0 text-amber" aria-hidden />}
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 whitespace-nowrap">
                      {p.accounts.length > 0 && (
                        <>
                          <span className="min-w-0 truncate font-medium text-fg">{p.accounts.join(", ")}</span>
                          {/* Outside the cut name so it survives the cut. */}
                          <span className="shrink-0 whitespace-pre font-medium text-fg">{t("settings.connections.problemSeparator")}</span>
                        </>
                      )}
                      <span className="shrink-0">{p.text}</span>
                    </p>
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

          <div className="mt-2 flex flex-wrap items-center gap-4 border-t border-surface-3 pt-2.5 md:hidden">
            {conn.canManage && (
              <button type="button" onClick={stop(() => { void openManage(); })} disabled={manage.isPending || syncing || isPending}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-fg-dim">
                <ExternalLink className="size-3.5" />{t(manage.isPending ? "common.busy.opening" : "settings.connections.manage")}
              </button>
            )}
            <button
              type="button"
              onClick={stop(() => sync.mutate(conn.id))}
              disabled={syncSpins}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-fg-dim"
            >
              <RefreshCw className={`size-3.5 ${syncSpins ? "animate-spin" : ""}`} />
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

  function Summary() {
    const line = "mt-0.5 text-xs truncate";
    if (isError) {
      return (
        <p className={`${line} text-red`} title={conn.lastError ?? undefined}>
          {t("settings.connections.status.error")}
        </p>
      );
    }
    if (syncing || isPending) {
      return (
        <p className={`${line} text-fg-dim`}>
          {t(isAwaiting ? "settings.connections.status.awaiting" : isPending ? "settings.connections.status.pending" : "settings.connections.status.syncing")}
        </p>
      );
    }
    if (issues.length > 0) {
      return (
        <p className={`${line} text-amber`}>
          {t(issuesSummaryKey(conn, issues))}
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

export function ConnectionRowsSkeleton({ deletable }: { deletable: boolean }) {
  return (
    <Skeleton className="flex flex-col gap-2.5">
      {Array.from({ length: 2 }, (_, row) => (
        <div key={row} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3.5">
          <Bone className="size-9 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <TextBone text="text-[15px]" className="w-32" />
            <TextBone text="mt-0.5 text-xs" className="w-24" />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <div className="hidden items-center gap-1.5 md:flex">
              {Array.from({ length: deletable ? 3 : 2 }, (_, i) => (
                <span key={i} className="flex size-8 items-center justify-center">
                  <Bone className="size-4" />
                </span>
              ))}
            </div>
            <ChevronRight aria-hidden className="size-4 text-fg-faint" />
          </div>
        </div>
      ))}
    </Skeleton>
  );
}
