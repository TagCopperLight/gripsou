import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";

import { Surface } from "../../../ui/Surface";
import { Button } from "../../../ui/Button";
import { GridTable, SortHeader, TableEmpty } from "../../../ui/GridTable";
import { usePhone } from "../../../ui/usePhone";
import { PHONE_HIDDEN, HEAD_CELL, ROW_CELLS, ROW_HOVER, type Track } from "../../../ui/gridTable";
import { FxAsterisk, FxFootnote } from "../../../ui/FxNote";
import { MaskedMoney } from "../../../ui/MaskedMoney";
import { CardTitle } from "../../../ui/CardTitle";
import { Percent } from "../../../ui/Percent";
import { Sparkline } from "./Sparkline";
import { AssetModal } from "./AssetModal";
import { RecordLotsModal } from "./RecordLotsModal";
import { CardError } from "../../../ui/CardError";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { Bone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { HoldingBadge } from "../../../ui/HoldingBadge";
import { formatQuantity } from "../../../lib/money";
import { sumDecimals } from "../../../lib/decimal";
import {
  CASH_COLOR, cashGlyph, holdingAccountTypes, kindLabel, shownHoldingLines, toggleHoldingSort,
  type HoldingSort, type HoldingSortKey,
} from "../../../lib/holdings";
import type { Holding } from "../../../api/wire";
import { accountTypeLabel } from "../../../lib/accounts";
import { useHoldings } from "../../../api/holdings";
import { usePrivacy } from "../../../auth/usePrivacy";

type Column = {
  labelKey: string;
  align: "left" | "right";
  sort?: HoldingSortKey;
  track: Track;
  pad: string;
};

// Only the asset column grows; the others have floors, so searching or filtering never moves a column. Below the sum of the floors the table scrolls sideways.
// A phone keeps the asset and its value, with the gain under the value.
const COLUMNS: Column[] = [
  { labelKey: "dashboard.holdings.columns.asset", align: "left", sort: "asset", track: { min: "220px", max: "3fr", phone: { min: "0px", max: "1fr" } }, pad: "pl-3 pr-4" },
  { labelKey: "dashboard.holdings.columns.quantity", align: "right", sort: "qty", track: { min: "96px", max: "max-content", phone: null }, pad: `pr-4 ${PHONE_HIDDEN}` },
  { labelKey: "dashboard.holdings.columns.account", align: "left", track: { min: "110px", max: "180px", phone: null }, pad: `pr-4 ${PHONE_HIDDEN}` },
  { labelKey: "dashboard.holdings.columns.accountType", align: "left", track: { min: "110px", max: "150px", phone: null }, pad: `pr-4 ${PHONE_HIDDEN}` },
  { labelKey: "dashboard.holdings.columns.value", align: "right", sort: "value", track: { min: "7rem", max: "max-content", phone: { min: "max-content" } }, pad: "pr-4 max-md:pr-3" },
  { labelKey: "dashboard.holdings.columns.unrealizedPnl", align: "right", sort: "pnl", track: { min: "7rem", max: "max-content", phone: null }, pad: `pr-4 ${PHONE_HIDDEN}` },
  { labelKey: "dashboard.holdings.columns.thirtyDays", align: "right", track: { min: "108px", phone: null }, pad: `pr-3 ${PHONE_HIDDEN}` },
];
const TRACKS = COLUMNS.map((c) => c.track);
const PAD = COLUMNS.map((c) => c.pad);

type HoldingsCardProps = {
  className?: string;
};

export function HoldingsCard({ className = "" }: HoldingsCardProps) {
  const { t } = useTranslation();
  const { data, isPending, refetch } = useHoldings();
  const ready = data !== undefined;
  const privacy = usePrivacy();
  const phone = usePhone();
  const [sort, setSort] = useState<HoldingSort | null>({ key: "value", dir: "desc" });
  const [accountType, setAccountType] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Holding | null>(null);
  const [lotFor, setLotFor] = useState<Holding | null>(null);

  const accountTypes = useMemo(() => holdingAccountTypes(data ?? []), [data]);
  const netWorth = useMemo(() => Number(sumDecimals((data ?? []).map((h) => h.value))), [data]);
  const rows = useMemo(
    () => shownHoldingLines(data ?? [], { accountType, query }, sort),
    [data, accountType, query, sort],
  );
  const toggleSort = (key: HoldingSortKey) => setSort((prev) => toggleHoldingSort(prev, key));

  return (
    <Surface className={`w-full ${className}`}>
      <LoadingFrame loading={isPending} className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <CardTitle privacy={ready && privacy}>
            {t("dashboard.holdings.title")}
          </CardTitle>
          <label className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 has-disabled:opacity-40 md:w-64">
            <Search className="size-4 text-fg-faint shrink-0" />
            {/* The label dims as a whole: the input mustn't dim a second time inside it. */}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("dashboard.holdings.searchPlaceholder")}
              className="bg-transparent text-sm text-fg placeholder:text-fg-faint outline-none w-full disabled:opacity-100"
            />
          </label>
        </div>

        {!ready && !isPending ? (
          <CardError
            onRetry={() => refetch()}
            className="mt-4 h-64"
          />
        ) : (
        <>
        <div className="flex flex-wrap items-center gap-1.5 mt-4">
          {[null, ...accountTypes].map((c) => {
            const selected = c === accountType;
            return (
              <button
                key={c ?? ""}
                type="button"
                onClick={() => setAccountType(c)}
                className={`rounded-lg px-3 py-1 text-xs font-medium cursor-pointer transition-colors duration-140 ${
                  selected
                    ? "bg-fg text-bg"
                    : "bg-surface-2 text-fg-dim enabled:hover:text-fg"
                }`}
              >
                {c === null
                  ? t("dashboard.holdings.all")
                  : accountTypeLabel(t, c)}
              </button>
            );
          })}
          {!ready && (
            <Skeleton className="flex gap-1.5">
              <Bone className="h-6 w-20 rounded-lg" />
              <Bone className="h-6 w-24 rounded-lg" />
            </Skeleton>
          )}
        </div>

        {ready && rows.length === 0 ? (
          <TableEmpty
            icon={<Search />}
            message={t("dashboard.holdings.noMatch", { query: query.trim() })}
            action={
              <Button variant="ghost" onClick={() => { setQuery(""); setAccountType(null); }}>
                {t("dashboard.holdings.clearSearch")}
              </Button>
            }
          />
        ) : (
        <div className="mt-4">
        <GridTable
          tracks={TRACKS}
          head={COLUMNS.map((col) => {
            const active = col.sort && sort?.key === col.sort;
            return (
              <th
                key={col.labelKey}
                role="columnheader"
                className={`${HEAD_CELL} whitespace-nowrap ${col.pad} ${col.align === "right" ? "justify-end" : ""}`}
              >
                {col.sort ? (
                  <SortHeader
                    label={t(col.labelKey)}
                    active={Boolean(active)}
                    asc={sort?.dir === "asc"}
                    right={col.align === "right"}
                    onClick={() => toggleSort(col.sort!)}
                  />
                ) : (
                  t(col.labelKey)
                )}
              </th>
            );
          })}
        >
            {!ready && <HoldingRowsSkeleton />}
            {rows.map((line) => {
              const h = line.holdings[0];
              const up = Number(h.gl) >= 0;
              const hasPnl = h.kind !== "cash";
              // No rate: the value is zero, so a gain would be invented.
              const showPnl = hasPnl && !line.fxMissing;
              const accountName = line.account?.name ?? t("dashboard.holdings.multipleAccounts");
              return (
                <tr
                  key={line.key}
                  role="row"
                  onClick={hasPnl ? () => setSelected(h) : undefined}
                  className={`${ROW_CELLS} ${hasPnl ? `cursor-pointer ${ROW_HOVER}` : ""}`}
                >
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
                          {/* The ring keeps the dot from disappearing into a light logo. */}
                          <span
                            data-testid="gap-dot"
                            className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber ring-2 ring-surface"
                          />
                        </button>
                      ) : (
                        <HoldingBadge
                          logo={h.logo}
                          ticker={h.ticker}
                          fallbackText={h.kind === "cash" ? cashGlyph(h.ticker) : undefined}
                          color={h.kind === "cash" ? CASH_COLOR : undefined}
                          className="size-8 rounded-lg text-[13px]"
                        />
                      )}
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm text-fg leading-tight" title={h.name}>
                          {h.name}
                        </span>
                        <span className="truncate text-xs text-fg-faint font-mono">
                          {h.ticker} · {kindLabel(t, h.kind)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td role="cell" className={`justify-end ${PAD[1]}`}>
                    {hasPnl ? (
                      <span className="text-fg-dim font-mono">{formatQuantity(h.qty)}</span>
                    ) : (
                      <span className="text-fg-faint">-</span>
                    )}
                  </td>
                  <td role="cell" className={PAD[2]}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="inline-block size-3 shrink-0 rounded" style={{ background: line.account?.color ?? CASH_COLOR }} />
                      <span className="truncate text-fg-dim" title={accountName}>{accountName}</span>
                    </span>
                  </td>
                  <td role="cell" className={PAD[3]}>
                    <span className="truncate whitespace-nowrap rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-fg-faint">
                      {line.accountType === null
                        ? t("dashboard.holdings.multipleTypes")
                        : accountTypeLabel(t, line.accountType)}
                    </span>
                  </td>
                  <td role="cell" className={`justify-end whitespace-nowrap max-md:flex-col max-md:items-end max-md:justify-center ${PAD[4]}`}>
                    {line.fxMissing ? (
                      <span className="relative">
                        {line.valueNative === null ? (
                          <span className="text-fg-faint">-</span>
                        ) : (
                          <MaskedMoney masked={privacy.masked} value={line.valueNative} currency={h.priceCurrency} className="text-fg-dim" />
                        )}
                        <FxAsterisk />
                      </span>
                    ) : (
                      <MaskedMoney masked={privacy.masked} value={line.value} className="text-fg" />
                    )}
                    {phone && showPnl && (
                      <Percent
                        value={h.glPct}
                        signed
                        fractionDigits={1}
                        className={`text-xs ${up ? "text-green" : "text-red"}`}
                      />
                    )}
                  </td>
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
        {(data ?? []).some((h) => h.fxMissing) && <FxFootnote className="mt-4">{t("fx.holdings")}</FxFootnote>}
        </>
        )}
      </LoadingFrame>

      {selected && (
        <AssetModal
          holding={selected}
          netWorth={netWorth}
          onClose={() => setSelected(null)}
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

/** The table's body can't hold a `Skeleton`, so each row pulses on its own and is hidden from screen readers. */
function HoldingRowsSkeleton() {
  return [56, 40, 48, 32].map((w) => (
    <tr key={w} role="row" aria-hidden className={`${ROW_CELLS} motion-safe:animate-pulse`}>
      <td role="cell" className={`py-2.25 ${PAD[0]}`}>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Bone className="size-8 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col">
            <TextBone text="text-sm leading-tight" style={{ width: `${w}%` }} />
            <TextBone text="text-xs" className="w-20" />
          </div>
        </div>
      </td>
      <td role="cell" className={`justify-end ${PAD[1]}`}><TextBone text="text-sm" className="w-10" /></td>
      <td role="cell" className={PAD[2]}><Bone className="h-3 w-24" /></td>
      <td role="cell" className={PAD[3]}><Bone className="h-4.5 w-16 rounded" /></td>
      <td role="cell" className={`justify-end ${PAD[4]}`}><Bone className="h-3 w-20" /></td>
      <td role="cell" className={`justify-end ${PAD[5]}`}>
        <div className="flex flex-col items-end">
          <TextBone text="text-sm" className="w-16" />
          <TextBone text="text-xs" className="w-10" />
        </div>
      </td>
      <td role="cell" className={`justify-end ${PAD[6]}`}><Bone className="h-8 w-24" /></td>
    </tr>
  ));
}
