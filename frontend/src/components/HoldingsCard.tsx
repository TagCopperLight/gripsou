import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { Sparkline } from "./Sparkline";
import { AssetModal } from "./AssetModal";
import { RecordLotsModal } from "./RecordLotsModal";
import { CardState } from "./CardState";
import { HoldingBadge } from "./HoldingBadge";
import { formatQuantity } from "../lib/money";
import { aggregateCash } from "../lib/holdings";
import { KIND_LABEL_KEY, accountTypeLabel, type Holding } from "../api/types";
import { useHoldings } from "../api/hooks";

type SortKey = "asset" | "qty" | "value" | "pnl";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir };

type Column = {
  labelKey: string;
  align: "left" | "right";
  sort?: SortKey;
  /** Dropped below md — a phone fits asset / value / P L and nothing more. */
  desktopOnly?: boolean;
};

const HIDDEN_ON_PHONE = "hidden md:table-cell";

const COLUMNS: Column[] = [
  { labelKey: "dashboard.holdings.columns.asset", align: "left", sort: "asset" },
  { labelKey: "dashboard.holdings.columns.quantity", align: "right", sort: "qty", desktopOnly: true },
  { labelKey: "dashboard.holdings.columns.account", align: "left", desktopOnly: true },
  { labelKey: "dashboard.holdings.columns.accountType", align: "left", desktopOnly: true },
  { labelKey: "dashboard.holdings.columns.value", align: "right", sort: "value" },
  { labelKey: "dashboard.holdings.columns.unrealizedPnl", align: "right", sort: "pnl" },
  { labelKey: "dashboard.holdings.columns.thirtyDays", align: "right", desktopOnly: true },
];

const GREEN = "var(--color-green)";
const RED = "var(--color-red)";

// Cash has no meaningful quantity or P/L; those rows always sort to the bottom.
function qtyOf(h: Holding): number | null {
  return h.kind === "cash" ? null : Number(h.qty);
}

function pnlOf(h: Holding): number | null {
  return h.kind === "cash" ? null : Number(h.gl);
}

function compareNullable(a: number | null, b: number | null, mul: number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return (a - b) * mul;
}

function compare(a: Holding, b: Holding, sort: Sort): number {
  const mul = sort.dir === "asc" ? 1 : -1;
  switch (sort.key) {
    case "asset":
      return a.name.localeCompare(b.name) * mul;
    case "qty":
      return compareNullable(qtyOf(a), qtyOf(b), mul);
    case "value":
      return (Number(a.value) - Number(b.value)) * mul;
    case "pnl":
      return compareNullable(pnlOf(a), pnlOf(b), mul);
  }
}

type HoldingsCardProps = {
  className?: string;
};

export function HoldingsCard({ className = "" }: HoldingsCardProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useHoldings();
  const ready = data !== undefined;
  // Cash is the same instrument across accounts; show one summed line per
  // currency here, with the per-account split living on the Accounts tab.
  const holdings = useMemo(
    () => aggregateCash(data ?? [], t("dashboard.holdings.multipleAccounts")),
    [data, t],
  );
  const [sort, setSort] = useState<Sort | null>({ key: "value", dir: "desc" });
  const [accountType, setAccountType] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Holding | null>(null);
  const [lotFor, setLotFor] = useState<Holding | null>(null);

  // Filter by stable account-type key; keep the backend label around as the
  // i18n fallback for each key.
  const accountTypes = useMemo(
    () => ["All", ...new Set(holdings.map((h) => h.accountType))],
    [holdings],
  );
  const accountTypeFallback = useMemo(
    () => new Map(holdings.map((h) => [h.accountType, h.accountTypeLabel])),
    [holdings],
  );

  const netWorth = useMemo(
    () => holdings.reduce((sum, h) => sum + Number(h.value), 0),
    [holdings],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = holdings.filter(
      (h) =>
        (accountType === "All" || h.accountType === accountType) &&
        (q === "" ||
          h.name.toLowerCase().includes(q) ||
          h.ticker.toLowerCase().includes(q)),
    );
    return sort ? [...filtered].sort((a, b) => compare(a, b, sort)) : filtered;
  }, [holdings, accountType, query, sort]);

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "asset" ? "asc" : "desc" },
    );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <h2 className="text-fg font-semibold text-sm">
            {t("dashboard.holdings.title")}
            {ready && (
              <span className="text-fg-faint font-normal ml-3">
                {t("dashboard.holdings.assetsCount", { count: holdings.length })}
              </span>
            )}
          </h2>
          <label className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 md:w-64">
            <Search className="size-4 text-fg-faint shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dashboard.holdings.searchPlaceholder")}
              className="bg-transparent text-sm text-fg placeholder:text-fg-faint outline-none w-full"
            />
          </label>
        </div>

        {!ready ? (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => refetch()}
            className="mt-4 h-64"
          />
        ) : (
        <>
        <div className="flex flex-wrap items-center gap-1.5 mt-4">
          {accountTypes.map((c) => {
            const selected = c === accountType;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setAccountType(c)}
                className={`rounded-lg px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-140 ${
                  selected
                    ? "bg-fg text-bg"
                    : "bg-surface-2 text-fg-dim hover:text-fg"
                }`}
              >
                {c === "All"
                  ? t("dashboard.holdings.all")
                  : accountTypeLabel(t, c, accountTypeFallback.get(c) ?? c)}
              </button>
            );
          })}
        </div>

        <table className="w-full mt-4 border-separate border-spacing-0">
          <thead>
            <tr>
              {COLUMNS.map((col) => {
                const active = col.sort && sort?.key === col.sort;
                return (
                  <th
                    key={col.labelKey}
                    className={`pb-2 px-2 md:px-3 text-[11px] font-medium tracking-wide font-mono whitespace-nowrap ${
                      col.align === "right" ? "text-right" : "text-left"
                    } ${col.desktopOnly ? HIDDEN_ON_PHONE : ""}`}
                  >
                    {col.sort ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.sort!)}
                        className={`inline-flex items-center gap-1 cursor-pointer transition-colors duration-140 ${
                          col.align === "right" ? "flex-row-reverse" : ""
                        } ${active ? "text-fg" : "text-fg-dim hover:text-fg"}`}
                      >
                        {t(col.labelKey)}
                        {active &&
                          (sort.dir === "asc" ? (
                            <ChevronUp className="size-3.5" />
                          ) : (
                            <ChevronDown className="size-3.5" />
                          ))}
                      </button>
                    ) : (
                      <span className="text-fg-faint">{t(col.labelKey)}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const up = Number(h.gl) >= 0;
              const hasPnl = h.kind !== "cash";
              // Cash rows are summary lines (no asset detail / purchase history),
              // so they are not clickable.
              return (
                <tr
                  key={h.id}
                  onClick={hasPnl ? () => setSelected(h) : undefined}
                  className={`transition-colors duration-140 ${
                    hasPnl ? "cursor-pointer hover:bg-hover" : ""
                  }`}
                >
                  {/* ASSET */}
                  <td className="max-w-0 w-full py-3 px-2 md:px-3 border-t border-surface-2">
                    <div className="flex items-center gap-3">
                      {Number(h.unexplainedQty) !== 0 ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLotFor(h);
                          }}
                          aria-label={t("dashboard.holdings.gap.open")}
                          title={t(
                            Number(h.unexplainedQty) > 0
                              ? "dashboard.holdings.gap.tooltipShort"
                              : "dashboard.holdings.gap.tooltipExcess",
                            { qty: formatQuantity(String(Math.abs(Number(h.unexplainedQty)))) },
                          )}
                          className="relative shrink-0 cursor-pointer"
                        >
                          <HoldingBadge
                            logo={h.logo}
                            ticker={h.ticker}
                            className="size-8 rounded-lg text-[13px]"
                          />
                          {/* The ring is load-bearing: without it the dot
                              disappears into a light logo. */}
                          <span
                            data-testid="gap-dot"
                            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber ring-2 ring-surface"
                          />
                        </button>
                      ) : (
                        <HoldingBadge
                          logo={h.logo}
                          ticker={h.ticker}
                          fallbackText={h.kind === "cash" && h.ticker === "EUR" ? "€" : undefined}
                          className="size-8 rounded-lg text-[13px]"
                        />
                      )}
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-fg leading-tight md:whitespace-normal">
                          {h.name}
                        </span>
                        <span className="truncate text-xs text-fg-faint font-mono">
                          {h.ticker} · {t(KIND_LABEL_KEY[h.kind])}
                        </span>
                      </div>
                    </div>
                  </td>
                  {/* QUANTITY */}
                  <td className={`py-3 px-3 border-t border-surface-2 text-right ${HIDDEN_ON_PHONE}`}>
                    {hasPnl ? (
                      <span className="text-sm text-fg-dim font-mono">
                        {formatQuantity(h.qty)}
                      </span>
                    ) : (
                      <span className="text-sm text-fg-faint">-</span>
                    )}
                  </td>
                  {/* ACCOUNT */}
                  <td className={`py-3 px-3 border-t border-surface-2 ${HIDDEN_ON_PHONE}`}>
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-sm shrink-0"
                        style={{ background: h.accountColor }}
                      />
                      <span className="text-sm text-fg-dim">
                        {h.accountName}
                      </span>
                    </div>
                  </td>
                  {/* ACCOUNT TYPE */}
                  <td className={`py-3 px-3 border-t border-surface-2 ${HIDDEN_ON_PHONE}`}>
                    <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
                      {accountTypeLabel(t, h.accountType, h.accountTypeLabel)}
                    </span>
                  </td>
                  {/* VALUE */}
                  <td className="py-3 px-2 md:px-3 border-t border-surface-2 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {h.fxMissing && (
                        <span
                          title={t("dashboard.fxMissing")}
                          className="text-fg-faint text-xs leading-none"
                          aria-label={t("dashboard.fxMissing")}
                        >
                          ⚠
                        </span>
                      )}
                      <Money value={h.value} className="text-sm text-fg" />
                    </span>
                  </td>
                  {/* UNREALIZED P/L */}
                  <td className="py-3 px-2 md:px-3 border-t border-surface-2 text-right whitespace-nowrap">
                    {hasPnl ? (
                      <div className="flex flex-col items-end">
                        <Money
                          value={h.gl}
                          signed
                          className={`text-sm ${up ? "text-green" : "text-red"}`}
                        />
                        <Percent
                          value={h.glPct}
                          signed
                          fractionDigits={1}
                          className={`text-xs ${up ? "text-green" : "text-red"}`}
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-fg-faint">-</span>
                    )}
                  </td>
                  {/* 30D */}
                  <td className={`py-3 px-3 border-t border-surface-2 ${HIDDEN_ON_PHONE}`}>
                    <div className="flex justify-end">
                      {h.spark ? (
                        <Sparkline data={h.spark.map(Number)} color={up ? GREEN : RED} />
                      ) : (
                        <span className="text-sm text-fg-faint">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </>
        )}
      </div>

      {selected && (
        <AssetModal
          holding={selected}
          netWorth={netWorth}
          onClose={() => setSelected(null)}
          // One modal at a time: the asset modal closes as the record modal
          // opens, so the user never has two stacked dialogs.
          onRecordLots={() => {
            setLotFor(selected);
            setSelected(null);
          }}
        />
      )}

      {lotFor && <RecordLotsModal holding={lotFor} onClose={() => setLotFor(null)} />}
    </Surface>
  );
}
