import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Surface } from "./Surface";
import { Button } from "./Button";
import { GridTable, TableEmpty } from "./GridTable";
import { HEAD_CELL, ROW_CELLS, ROW_HOVER } from "./gridTable";
import { FxAsterisk, FxFootnote } from "./FxNote";
import { MaskedMoney, PrivacyEye } from "./PrivateMoney";
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
import { usePrivacy } from "../auth/usePrivacy";

type SortKey = "asset" | "qty" | "value" | "pnl";
type SortDir = "asc" | "desc";
type Sort = { key: SortKey; dir: SortDir };

type Column = {
  labelKey: string;
  align: "left" | "right";
  sort?: SortKey;
  /** The column's grid track (see `gridTable.ts`). */
  track: string;
  /** Its gutter: every cell pays for the space on its right. */
  pad: string;
};

// Only the asset column grows; the others have floors (and the text ones
// ceilings, truncating past them), so searching or filtering never moves a
// column. Below the sum of the floors the table scrolls sideways.
const COLUMNS: Column[] = [
  { labelKey: "dashboard.holdings.columns.asset", align: "left", sort: "asset", track: "minmax(220px, 3fr)", pad: "pl-3 pr-4" },
  { labelKey: "dashboard.holdings.columns.quantity", align: "right", sort: "qty", track: "minmax(96px, max-content)", pad: "pr-4" },
  { labelKey: "dashboard.holdings.columns.account", align: "left", track: "minmax(110px, 180px)", pad: "pr-4" },
  { labelKey: "dashboard.holdings.columns.accountType", align: "left", track: "minmax(110px, 150px)", pad: "pr-4" },
  { labelKey: "dashboard.holdings.columns.value", align: "right", sort: "value", track: "minmax(7rem, max-content)", pad: "pr-4" },
  { labelKey: "dashboard.holdings.columns.unrealizedPnl", align: "right", sort: "pnl", track: "minmax(7rem, max-content)", pad: "pr-4" },
  { labelKey: "dashboard.holdings.columns.thirtyDays", align: "right", track: "108px", pad: "pr-3" },
];
const TRACKS = COLUMNS.map((c) => c.track).join(" ");
const PAD = COLUMNS.map((c) => c.pad);
const MIN_WIDTH = "55rem";

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
  const privacy = usePrivacy();
  // Cash is the same instrument across accounts; show one summed line per
  // currency here, with the per-account split living on the Accounts tab.
  const multiple = t("dashboard.holdings.multipleAccounts");
  const holdings = useMemo(() => aggregateCash(data ?? [], multiple), [data, multiple]);
  const [sort, setSort] = useState<Sort | null>({ key: "value", dir: "desc" });
  const [accountType, setAccountType] = useState("All");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Holding | null>(null);
  const [lotFor, setLotFor] = useState<Holding | null>(null);

  // Filter by stable account-type key, read off the accounts themselves
  // rather than the merged cash line, which may span several types.
  const accountTypes = useMemo(
    () => ["All", ...new Set((data ?? []).map((h) => h.accountType))],
    [data],
  );

  const netWorth = useMemo(
    () => holdings.reduce((sum, h) => sum + Number(h.value), 0),
    [holdings],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Filter before merging the cash, so a filtered list's cash line is that
    // type's cash only (the PEA's own liquidity under "PEA").
    const filtered = aggregateCash(
      (data ?? []).filter(
        (h) =>
          (accountType === "All" || h.accountType === accountType) &&
          (q === "" ||
            h.name.toLowerCase().includes(q) ||
            h.ticker.toLowerCase().includes(q)),
      ),
      multiple,
    );
    return sort ? [...filtered].sort((a, b) => compare(a, b, sort)) : filtered;
  }, [data, multiple, accountType, query, sort]);

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
            {ready && privacy.enabled && (
              <span className="ml-3 inline-flex align-middle">
                <PrivacyEye size="sm" masked={privacy.masked} toggle={privacy.toggle} />
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
                  : accountTypeLabel(t, c)}
              </button>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <TableEmpty
            icon={<Search />}
            message={t("dashboard.holdings.noMatch", { query: query.trim() })}
            action={
              <Button variant="ghost" onClick={() => { setQuery(""); setAccountType("All"); }}>
                {t("dashboard.holdings.clearSearch")}
              </Button>
            }
          />
        ) : (
        <div className="mt-4">
        <GridTable
          columns={TRACKS}
          minWidth={MIN_WIDTH}
          head={COLUMNS.map((col) => {
            const active = col.sort && sort?.key === col.sort;
            return (
              <th
                key={col.labelKey}
                role="columnheader"
                className={`${HEAD_CELL} whitespace-nowrap ${col.pad} ${col.align === "right" ? "justify-end" : ""}`}
              >
                {col.sort ? (
                  <button
                    type="button"
                    onClick={() => toggleSort(col.sort!)}
                    className={`inline-flex h-4 items-center gap-1 cursor-pointer uppercase transition-colors duration-140 ${
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
                  t(col.labelKey)
                )}
              </th>
            );
          })}
        >
            {rows.map((h) => {
              const up = Number(h.gl) >= 0;
              const hasPnl = h.kind !== "cash";
              // No rate: the value is zero, so a gain would be invented.
              const showPnl = hasPnl && !h.fxMissing;
              // Cash rows are summary lines (no asset detail / purchase history),
              // so they are not clickable.
              return (
                <tr
                  key={h.id}
                  role="row"
                  onClick={hasPnl ? () => setSelected(h) : undefined}
                  className={`${ROW_CELLS} ${hasPnl ? `cursor-pointer ${ROW_HOVER}` : ""}`}
                >
                  {/* ASSET */}
                  <td role="cell" className={`py-2.25 ${PAD[0]}`}>
                    <div className="flex min-w-0 items-center gap-3">
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
                        <span className="truncate text-sm text-fg leading-tight" title={h.name}>
                          {h.name}
                        </span>
                        <span className="truncate text-xs text-fg-faint font-mono">
                          {h.ticker} · {t(KIND_LABEL_KEY[h.kind])}
                        </span>
                      </div>
                    </div>
                  </td>
                  {/* QUANTITY */}
                  <td role="cell" className={`justify-end ${PAD[1]}`}>
                    {hasPnl ? (
                      <span className="text-fg-dim font-mono">{formatQuantity(h.qty)}</span>
                    ) : (
                      <span className="text-fg-faint">-</span>
                    )}
                  </td>
                  {/* ACCOUNT */}
                  <td role="cell" className={PAD[2]}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-block size-3 shrink-0 rounded" style={{ background: h.accountColor }} />
                      <span className="truncate text-fg-dim" title={h.accountName}>{h.accountName}</span>
                    </span>
                  </td>
                  {/* ACCOUNT TYPE */}
                  <td role="cell" className={PAD[3]}>
                    <span className="truncate whitespace-nowrap rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-faint">
                      {accountTypeLabel(t, h.accountType)}
                    </span>
                  </td>
                  {/* VALUE */}
                  <td role="cell" className={`justify-end whitespace-nowrap ${PAD[4]}`}>
                    {h.fxMissing ? (
                      <span className="relative">
                        {h.valueNative === null ? (
                          <span className="text-fg-faint">-</span>
                        ) : (
                          <MaskedMoney masked={privacy.masked} value={h.valueNative} currency={h.priceCurrency} className="text-fg-dim" />
                        )}
                        <FxAsterisk />
                      </span>
                    ) : (
                      <MaskedMoney masked={privacy.masked} value={h.value} className="text-fg" />
                    )}
                  </td>
                  {/* UNREALIZED P/L */}
                  <td role="cell" className={`justify-end whitespace-nowrap ${PAD[5]}`}>
                    {showPnl ? (
                      <div className="flex flex-col items-end">
                        <MaskedMoney
                          masked={privacy.masked}
                          value={h.gl}
                          signed
                          className={up ? "text-green" : "text-red"}
                        />
                        <Percent
                          value={h.glPct}
                          signed
                          fractionDigits={1}
                          className={`text-xs ${up ? "text-green" : "text-red"}`}
                        />
                      </div>
                    ) : (
                      <span className="text-fg-faint">-</span>
                    )}
                  </td>
                  {/* 30D */}
                  <td role="cell" className={`justify-end ${PAD[6]}`}>
                    {h.spark ? (
                      <Sparkline data={h.spark.map(Number)} />
                    ) : (
                      <span className="text-fg-faint">-</span>
                    )}
                  </td>
                </tr>
              );
            })}
        </GridTable>
        </div>
        )}
        {holdings.some((h) => h.fxMissing) && <FxFootnote className="mt-4">{t("fx.holdings")}</FxFootnote>}
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
