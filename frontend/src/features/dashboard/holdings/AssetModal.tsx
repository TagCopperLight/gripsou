import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TrendingDown, TrendingUp, X } from "lucide-react";

import { MaskedMoney, PrivacyEye } from "../../../ui/MaskedMoney";
import { FxAsterisk, FxFootnote } from "../../../ui/FxNote";
import { GridTable } from "../../../ui/GridTable";
import { HEAD_CELL, ROW_CELLS, type Track } from "../../../ui/gridTable";
import { Percent } from "../../../ui/Percent";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { RangeSelector } from "../../../ui/RangeSelector";
import { GainPill } from "../../../ui/GainPill";
import { ChartLegend } from "../../../ui/ChartLegend";
import { ValueChart, type ChartSeries, type ChartUnit } from "../../../ui/ValueChart";
import { CardError } from "../../../ui/CardError";
import { LoadingFrame } from "../../../ui/LoadingFrame";
import { Bone, ChartBone, Skeleton, TextBone } from "../../../ui/Skeleton";
import { staleClass } from "../../../ui/stale";
import { CompositionSurface } from "./CompositionSurface";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { Modal } from "../../../ui/Modal";
import { IncompleteHistoryStrip } from "./IncompleteHistoryStrip";
import { formatQuantity } from "../../../lib/money";
import { lotCashAmount } from "../../../lib/lotRules";
import { formatDay } from "../../../lib/date";
import { colorForString } from "../../../lib/palette";
import type { Holding, Lot } from "../../../api/wire";
import { kindLabel } from "../../../lib/holdings";
import { useHoldingLots, useHoldingPrices } from "../../../api/holdings";
import { positionChart, priceChart } from "../../../lib/assetSeries";
import { usePrivacy } from "../../../auth/usePrivacy";
import { reportingOffered } from "../../../lib/reportingUnit";
import { currencySymbol } from "../../../lib/currency";
import { usePrefs } from "../../../auth/context";
import type { Range } from "../../../api/wire";
import { legendItems, plotSeries } from "../../../lib/valueChart";
import { FG_FAINT, GREEN } from "../../../lib/theme";
import { ColorSquare } from "../../../ui/ColorSquare";

// Four currency domains show here and must never be collapsed into one "native" currency:
// - Reporting (`users.prefs.currency`): capital invested, current value, total P/L, weight of net worth.
// - Price (`holding.priceCurrency`, the currency of the `price` row, not necessarily `holding.currency`: Powens may say EUR while Yahoo resolves a GBP listing): the asset-mode chart, its header figure and gain.
// - Amount (`holding.accountCurrency`): mean price per share (`lot_basis`, fee-inclusive), the purchase table, and the purchases chart (`PricePoint.accountPrice`, `PricePoint.invested`).
// - Reporting again, behind the chart's unit switch: redrawn from `PricePoint.reportingPrice`, so its gain includes the currency's own move.
// `holding.currency` is the quote currency: it labels identity, never an amount here.


type Mode = "asset" | "purchases";


type AssetModalProps = {
  holding: Holding;
  netWorth: number;
  onClose: () => void;
  onRecordLots?: () => void;
};

export function AssetModal({ holding, netWorth, onClose, onRecordLots }: AssetModalProps) {
  const { t } = useTranslation();
  const reader = usePrefs().currency;
  const [mode, setMode] = useState<Mode>("asset");
  const [range, setRange] = useState<Range>("1mo");
  const [unit, setUnit] = useState<ChartUnit>("value");
  const privacy = usePrivacy();
  const masked = privacy.masked;
  const body = useRef<HTMLDivElement>(null);

  const { data: priceData, isPending: pricesLoading, isPlaceholderData: pricesStale, refetch: refetchPrices } =
    useHoldingPrices(holding.id, range);
  const { data: txnData, isPending: txnLoading, refetch: refetchTxn } =
    useHoldingLots(holding.id);
  const prices = useMemo(() => priceData ?? [], [priceData]);

  const chartReady = priceData !== undefined;
  const stale = staleClass(pricesStale);

  const up = Number(holding.gl) >= 0;
  const chartCurrency = mode === "asset" ? holding.priceCurrency : holding.accountCurrency;
  const offered = reportingOffered(chartCurrency, reader, prices);
  // Private mode: the purchases chart plots the position's own value, so it shows in % only.
  const percentOnly = masked && mode === "purchases";
  // A tab that doesn't offer the choice never leaves the switch on it.
  const shownUnit: ChartUnit = percentOnly ? "percent" : unit === "reporting" && !offered ? "value" : unit;
  const inReporting = shownUnit === "reporting";
  const shownCurrency = inReporting ? reader : chartCurrency;
  const UNIT_OPTIONS = [
    { value: "value", label: t("common.value") },
    ...(offered ? [{ value: "reporting", label: currencySymbol(reader) }] : []),
    { value: "percent", label: "%" },
  ];

  const { series, headerValue, gainAbs, gainPct, chartLabel } = useMemo(() => {
    if (mode === "asset") {
      const chart = priceChart(prices, holding.price, inReporting);
      return {
        ...chart,
        series: [
          { name: t("dashboard.assetModal.unitPrice"), data: chart.points, color: colorForString(holding.ticker), area: true },
        ] satisfies ChartSeries[],
        chartLabel: t("dashboard.assetModal.unitPrice"),
      };
    }
    const chart = positionChart(prices, inReporting);
    return {
      ...chart,
      series: [
        { name: t("dashboard.assetModal.invested"), data: chart.invested, color: FG_FAINT, dashed: true },
        { name: t("dashboard.assetModal.positionValue"), data: chart.value, color: GREEN, area: true },
      ] satisfies ChartSeries[],
      chartLabel: t("dashboard.assetModal.positionValue"),
    };
  }, [holding, mode, prices, inReporting, t]);

  const chartUnit: ChartUnit = inReporting ? "value" : shownUnit;

  return (
    <Modal
      label={holding.name}
      onClose={onClose}
      focusWithin={[body]}
      className="absolute inset-0 flex flex-col overflow-hidden bg-surface md:inset-[5%] md:rounded-3xl"
    >
      <HoldingModalHeader
        holding={holding}
        afterName={privacy.enabled && <PrivacyEye masked={masked} toggle={privacy.toggle} />}
      >
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { value: "asset", label: t("dashboard.assetModal.asset") },
            { value: "purchases", label: t("dashboard.assetModal.purchases") },
          ]}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
        >
          <X className="size-5" />
        </button>
      </HoldingModalHeader>

      <div ref={body} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0 md:p-6 md:pt-0">
        {/* Side by side from xl (chart at least ~580 px beside the 512 px column). */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <LoadingFrame loading={pricesLoading} className="flex min-w-0 flex-col rounded-2xl bg-surface-2 p-4 md:p-5 xl:flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-fg-faint text-sm">{chartLabel}</span>
              {/* headerValue and gainAbs follow the chart: price domain in asset mode, amount domain in purchases mode. */}
              {/* The asset's own price is known up front; the position's value and gains come from the prices. */}
              {pricesLoading && mode === "purchases" ? (
                <Skeleton>
                  <TextBone text="text-2xl" className="w-36" />
                </Skeleton>
              ) : (
                <MaskedMoney
                  masked={masked && mode === "purchases"}
                  value={headerValue}
                  currency={shownCurrency}
                  className={`text-fg text-2xl font-semibold tracking-tight ${mode === "purchases" ? stale : ""}`}
                />
              )}
              {pricesLoading ? (
                <Skeleton>
                  {/* The pill's own height: a text-sm line and its py-1. */}
                  <Bone className="h-7 w-44 rounded-lg" />
                </Skeleton>
              ) : (
                <div className={`self-start ${stale}`}>
                  <GainPill value={gainAbs} pct={gainPct} masked={masked && mode === "purchases"} currency={shownCurrency} />
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-3">
              {!percentOnly && (
                <SegmentedControl
                  value={shownUnit}
                  onChange={(v) => setUnit(v as ChartUnit)}
                  options={UNIT_OPTIONS}
                />
              )}
              <ChartLegend items={legendItems(plotSeries(series, chartUnit, t("common.return")))} />
            </div>
          </div>

          {chartReady ? (
            <ValueChart
              series={series}
              unit={chartUnit}
              percentLabel={t("common.return")}
              height={340}
              className={`mt-4 ${stale}`}
              currency={shownCurrency}
            />
          ) : pricesLoading ? (
            <ChartBone className="mt-4 h-85" />
          ) : (
            <CardError
              onRetry={() => refetchPrices()}
              className="mt-4 h-85"
            />
          )}

          <div className="mt-3 flex justify-center overflow-x-auto">
            <RangeSelector value={range} onChange={setRange} />
          </div>
        </LoadingFrame>

        <div className="flex w-full flex-col gap-4 xl:w-lg xl:shrink-0">
          <StatsSurface
            holding={holding}
            meanPrice={holding.meanPrice}
            up={up}
            masked={masked}
          />
          {mode === "asset" ? (
            <AboutSurface holding={holding} netWorth={netWorth} />
          ) : (
            <PurchaseHistorySurface
              purchases={txnData}
              currency={holding.accountCurrency}
              masked={masked}
              loading={txnLoading}
              onRetry={() => refetchTxn()}
            />
          )}
          {onRecordLots && (
            <IncompleteHistoryStrip
              unexplainedQty={holding.unexplainedQty}
              onOpen={onRecordLots}
            />
          )}
        </div>
        </div>

        {mode === "asset" && holding.composition && (
          <CompositionSurface composition={holding.composition} />
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      <span className="relative w-fit text-fg font-mono font-semibold text-sm">{children}</span>
    </div>
  );
}

function StatsSurface({
  holding,
  meanPrice,
  up,
  masked,
}: {
  holding: Holding;
  meanPrice: string;
  up: boolean;
  masked: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <div className="grid grid-cols-2 gap-y-4 gap-x-6">
        <Stat label={t("dashboard.assetModal.quantityOwned")}>{formatQuantity(holding.qty)}</Stat>
        <Stat label={t("dashboard.assetModal.meanPricePerShare")}>
          <MaskedMoney masked={masked} value={meanPrice} currency={holding.accountCurrency} />
        </Stat>
        <Stat label={t("dashboard.assetModal.capitalInvested")}>
          <MaskedMoney masked={masked} value={holding.invested} />
        </Stat>
        <Stat label={t("dashboard.assetModal.currentValue")}>
          {/* No rate: the converted value is zero, so show the worth in its own currency, marked, as the Holdings table does. */}
          {holding.fxMissing && holding.valueNative !== null ? (
            <>
              <MaskedMoney masked={masked} value={holding.valueNative} currency={holding.priceCurrency} className="text-fg-dim" />
              <FxAsterisk />
            </>
          ) : (
            <MaskedMoney masked={masked} value={holding.value} />
          )}
        </Stat>
      </div>
      <hr className="border-surface-3 my-4" />
      <div className="flex flex-col items-start gap-1">
        <span className="text-fg-faint text-xs">{t("dashboard.assetModal.totalUnrealizedPnl")}</span>
        {holding.fxMissing ? (
          <span className="text-fg-faint text-base">-</span>
        ) : (
          <div className="flex items-baseline gap-2">
            <MaskedMoney
              masked={masked}
              value={holding.gl}
              signed
              className={`text-base font-semibold ${up ? "text-green" : "text-red"}`}
            />
            <span className={`font-mono text-base ml-2 ${up ? "text-green" : "text-red"}`}>
              (<Percent value={holding.glPct} signed />)
            </span>
          </div>
        )}
      </div>
      {holding.fxMissing && <FxFootnote className="mt-4">{t("fx.holdings")}</FxFootnote>}
    </div>
  );
}

function AboutRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-fg-faint text-sm">{label}</span>
      <span className="min-w-0 text-fg text-sm">{children}</span>
    </div>
  );
}

function AboutSurface({
  holding,
  netWorth,
}: {
  holding: Holding;
  netWorth: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <span className="text-fg text-sm font-semibold">{t("dashboard.assetModal.about")}</span>
      <div className="mt-1 divide-y divide-surface-3">
        <AboutRow label={t("dashboard.assetModal.type")}>{kindLabel(t, holding.kind)}</AboutRow>
        <AboutRow label={t("dashboard.assetModal.account")}>
          <span className="flex min-w-0 items-center gap-2">
            <ColorSquare color={holding.accountColor} />
            <span className="truncate">{holding.accountName}</span>
          </span>
        </AboutRow>
        <AboutRow label={t("dashboard.assetModal.weightOfNetWorth")}>
          {holding.fxMissing ? (
            <span className="text-fg-faint">-</span>
          ) : (
            <Percent
              value={netWorth ? Number(holding.value) / netWorth : 0}
              fractionDigits={1}
              className="text-fg"
            />
          )}
        </AboutRow>
      </div>
    </div>
  );
}

// Fixed tracks like every grid table (see `gridTable.ts`).
const HISTORY_TRACKS: Track[] = [
  { min: "150px", max: "1fr" },
  { min: "64px", max: "max-content" },
  { min: "96px", max: "max-content" },
  { min: "108px", max: "max-content" },
];

/** `currency` is the account's: amount and unit_price are amount-domain. */
function PurchaseHistorySurface({
  purchases,
  currency,
  masked,
  loading,
  onRetry,
}: {
  purchases: Lot[] | undefined;
  currency: string;
  masked: boolean;
  loading: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <h3 className="text-fg font-semibold text-sm">{t("dashboard.assetModal.purchaseHistory")}</h3>
      {purchases === undefined && !loading ? (
        <CardError
          onRetry={onRetry}
          className="mt-4 h-32"
        />
      ) : purchases?.length === 0 ? (
        <p className="text-fg-faint text-sm mt-4">{t("dashboard.assetModal.noPurchases")}</p>
      ) : (
        <div className="mt-3 -mx-3">
          <GridTable
            tracks={HISTORY_TRACKS}
            head={
              <>
                <th role="columnheader" className={`${HEAD_CELL} pl-3 pr-4`}>{t("dashboard.assetModal.columns.date")}</th>
                <th role="columnheader" className={`${HEAD_CELL} justify-end pr-4`}>{t("dashboard.assetModal.columns.qty")}</th>
                <th role="columnheader" className={`${HEAD_CELL} justify-end pr-4`}>{t("dashboard.assetModal.columns.price")}</th>
                <th role="columnheader" className={`${HEAD_CELL} justify-end pr-3`}>{t("dashboard.assetModal.columns.amount")}</th>
              </>
            }
          >
            {purchases === undefined && <HistoryRowsSkeleton />}
            {purchases?.map((p) => {
              const Icon = p.side === "sell" ? TrendingDown : TrendingUp;
              return (
                <tr key={p.id} role="row" className={`${ROW_CELLS} font-mono`}>
                  <td role="cell" className="gap-2 py-2 pl-3 pr-4 text-fg-dim">
                    {formatDay(p.t)}
                    <span className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 font-sans text-[11px] text-fg-faint">
                      <Icon className="size-3" />
                      {t(p.side === "sell" ? "dashboard.assetModal.sell" : "dashboard.assetModal.buy")}
                    </span>
                  </td>
                  <td role="cell" className="justify-end pr-4 text-fg-dim">{formatQuantity(p.qty)}</td>
                  <td role="cell" className="justify-end pr-4 text-fg-dim">
                    <MaskedMoney masked={masked} value={p.price} currency={currency} />
                  </td>
                  <td role="cell" className="justify-end whitespace-nowrap pr-3 text-fg">
                    <MaskedMoney masked={masked} value={lotCashAmount(p.side, p.qty, p.price, p.fee)} currency={currency} signed />
                  </td>
                </tr>
              );
            })}
          </GridTable>
        </div>
      )}
    </div>
  );
}

/** The table's body can't hold a `Skeleton`, so each row pulses on its own and is hidden from screen readers. */
function HistoryRowsSkeleton() {
  return Array.from({ length: 3 }, (_, i) => (
    <tr key={i} role="row" aria-hidden className={`${ROW_CELLS} motion-safe:animate-pulse`}>
      <td role="cell" className="gap-2 py-2 pl-3 pr-4">
        <TextBone text="text-sm" className="w-20" />
        <Bone className="h-5 w-12 rounded" />
      </td>
      <td role="cell" className="justify-end pr-4"><Bone className="h-3 w-8" /></td>
      <td role="cell" className="justify-end pr-4"><Bone className="h-3 w-16" /></td>
      <td role="cell" className="justify-end pr-3"><Bone className="h-3 w-18" /></td>
    </tr>
  ));
}
