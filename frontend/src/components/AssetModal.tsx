import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, TrendingDown, TrendingUp, X } from "lucide-react";

import { MaskedMoney, PrivacyEye } from "./PrivateMoney";
import { FxAsterisk, FxFootnote } from "./FxNote";
import { GridTable } from "./GridTable";
import { HEAD_CELL, ROW_CELLS } from "./gridTable";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { ChartLegend } from "./ChartLegend";
import { ValueChart, type ChartSeries, type ChartUnit } from "./ValueChart";
import { CardState } from "./CardState";
import { CompositionSurface } from "./CompositionSurface";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { Modal } from "./Modal";
import { IncompleteHistoryStrip } from "./IncompleteHistoryStrip";
import { formatQuantity, lotCashAmount } from "../lib/money";
import { formatDay } from "../lib/date";
import { colorForString } from "../lib/palette";
import { KIND_LABEL_KEY, type Holding, type Lot } from "../api/types";
import { useHoldingLots, useHoldingPrices } from "../api/hooks";
import { positionSeries, windowReturn } from "../lib/assetSeries";
import { usePrivacy } from "../auth/usePrivacy";
import { reportingOffered } from "../lib/reportingUnit";
import { currencySymbol } from "../lib/currency";
import { getPrefs } from "../lib/prefs";
import { rangeOptions, type Range } from "../lib/ranges";
import { legendItems, plotSeries } from "../lib/valueChart";

// This modal shows THREE currency domains on screen, plus a fourth behind the chart's unit
// switch. They are distinct and must
// never be collapsed into one "native" currency:
//
// - Reporting domain (`users.prefs.currency`, so no explicit `currency` option):
//   capitalInvested, currentValue, total unrealized P/L, weight of net worth.
// - Price domain (`holding.priceCurrency` — the currency stamped on the `price`
//   ROW we read, which is NOT necessarily `holding.currency`; Powens may label
//   an instrument EUR while Yahoo resolves a London listing quoted GBP): the
//   asset-mode chart, its header figure and gain.
// - Amount domain (`holding.accountCurrency`): everything the provider
//   denominated in the account — mean price per share (`holding.meanPrice`,
//   the same fee-inclusive figure `lot_basis` computes for RecordLotsModal,
//   NOT a market price), the purchase-history table's price/amount columns
//   (`Lot.price`/`Lot.fee`, and the derived cash amount), and the
//   purchases-mode chart, whose value line uses prices the server converted
//   into the account's currency (`PricePoint.accountPrice`).
//
// - Reader's currency again, as a chart choice: only when the chart's own
//   currency differs and a day converts, the switch's middle option redraws the
//   chart, header and gain from each day's converted price
//   (`PricePoint.reportingPrice`, at that day's rates). Its gain is last minus
//   first of that series, so it includes the currency's own move.
//
// `holding.currency` is the instrument's QUOTE currency. It labels the asset's
// identity, not any amount here, so it formats nothing on this screen.
//
// Never mix the domains without labeling — an unlabelled figure sitting next to
// one in another currency is the bug this split exists to prevent.


type Mode = "asset" | "purchases";


type AssetModalProps = {
  holding: Holding;
  /** Total net worth, for the "weight of net worth" stat. */
  netWorth: number;
  onClose: () => void;
  onRecordLots?: () => void;
};

export function AssetModal({ holding, netWorth, onClose, onRecordLots }: AssetModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("asset");
  const [range, setRange] = useState<Range>("1mo");
  const [unit, setUnit] = useState<ChartUnit>("value");
  const privacy = usePrivacy();
  const masked = privacy.masked;

  const { data: priceData, isError: pricesError, refetch: refetchPrices } =
    useHoldingPrices(holding.id, range);
  const { data: txnData, isError: txnError, refetch: refetchTxn } =
    useHoldingLots(holding.id);
  const prices = useMemo(() => priceData ?? [], [priceData]);
  const purchases = useMemo(() => txnData ?? [], [txnData]);

  // The chart needs prices; in "purchases" mode it also folds in transactions.
  const chartReady =
    mode === "asset"
      ? priceData !== undefined
      : priceData !== undefined && txnData !== undefined;
  const chartError = pricesError || (mode === "purchases" && txnError);
  const retryChart = () => {
    refetchPrices();
    if (mode === "purchases") refetchTxn();
  };

  const qtyNum = Number(holding.qty);
  // Unconverted, not `holding.invested`: it is the fallback for a series built
  // from unconverted prices and purchase amounts, so mixing in the reporting-
  // currency figure would put two currencies on one line.
  const investedNum = Number(holding.investedNative);
  // The server's fee-inclusive mean buy price (`lot_basis`) — the same figure
  // RecordLotsModal shows under the same label. It is "0" only when no buy is
  // recorded at all (e.g. a provider that reports a balance but no lots); in
  // that one case fall back to the plain average so the stat does not read as
  // zero for a real position. Amount-domain (account currency), not a market
  // price — labelled with accountCurrency below, never the price row's or the
  // instrument's currency.
  const meanPrice =
    holding.meanPrice !== "0"
      ? Number(holding.meanPrice)
      : qtyNum === 0
        ? 0
        : Number(holding.investedNative) / qtyNum;
  const up = Number(holding.gl) >= 0;
  const chartCurrency = mode === "asset" ? holding.priceCurrency : holding.accountCurrency;
  const reader = getPrefs().currency;
  const offered = reportingOffered(chartCurrency, reader, prices);
  // Private mode: the purchases chart plots the position's own value, so it
  // shows in % only (the unit price of the asset tab is public).
  const percentOnly = masked && mode === "purchases";
  // A tab where the choice is not offered never leaves the switch on it.
  const shownUnit: ChartUnit = percentOnly ? "percent" : unit === "reporting" && !offered ? "value" : unit;
  const inReporting = shownUnit === "reporting";
  const shownCurrency = inReporting ? reader : chartCurrency;
  const UNIT_OPTIONS = [
    { value: "value", label: t("common.value") },
    ...(offered ? [{ value: "reporting", label: currencySymbol(reader) }] : []),
    { value: "percent", label: "%" },
  ];

  // Chart series + header figures depend on the mode and range.
  const { series, headerValue, gainAbs, gainPct, chartLabel } = useMemo(() => {
    if (mode === "asset") {
      const shown = inReporting
        ? prices
            .filter((p) => p.reportingPrice !== null)
            .map((p) => ({ t: p.t, v: Number(p.reportingPrice) }))
        : prices.map((p) => ({ t: p.t, v: Number(p.price) }));
      const values = shown.map((p) => p.v);
      const first = values[0] ?? 0;
      const last = values[values.length - 1] ?? 0;
      return {
        series: [
          {
            name: t("dashboard.assetModal.unitPrice"),
            data: shown.map((p) => [p.t, p.v] as [number, number]),
            color: colorForString(holding.ticker),
            area: true,
          },
        ] satisfies ChartSeries[],
        headerValue: inReporting ? last : Number(holding.price),
        gainAbs: last - first,
        gainPct: first ? (last - first) / first : 0,
        chartLabel: t("dashboard.assetModal.unitPrice"),
      };
    }
    const pts = positionSeries(
      prices,
      purchases,
      Number(holding.meanPrice),
      Number(holding.unexplainedCost),
      qtyNum,
      investedNum,
      inReporting ? "reporting" : "account",
    );
    const values = pts.map((p) => p.value);
    const last = values[values.length - 1] ?? 0;
    // What the position made over the window: its value's change minus what
    // was bought or sold meanwhile. A purchase is money put in, not a gain.
    const first = pts[0];
    const end = pts[pts.length - 1];
    const gain = first && end ? end.value - end.invested - (first.value - first.invested) : 0;
    const returns = windowReturn(
      pts.map((p) => [p.t, p.value] as [number, number]),
      pts.map((p) => [p.t, p.invested] as [number, number]),
    );
    return {
      series: [
        { name: t("dashboard.assetModal.invested"), data: pts.map((p) => [p.t, p.invested] as [number, number]), color: "#777471", dashed: true },
        { name: t("dashboard.assetModal.positionValue"), data: pts.map((p) => [p.t, p.value] as [number, number]), color: "#34d399", area: true },
      ] satisfies ChartSeries[],
      // The chart's own last point, not `holding.value`: this series is
      // amount-domain, so the header must read in the same currency as the
      // axis beneath it — not the reporting currency.
      headerValue: last,
      gainAbs: gain,
      gainPct: returns[returns.length - 1]?.[1] ?? 0,
      chartLabel: t("dashboard.assetModal.positionValue"),
    };
  }, [holding, mode, prices, purchases, qtyNum, investedNum, inReporting, t]);

  const gainUp = gainAbs >= 0;
  const chartUnit: ChartUnit = inReporting ? "value" : shownUnit;

  return (
    <Modal
      label={holding.name}
      onClose={onClose}
      className="absolute inset-0 flex flex-col overflow-hidden bg-surface md:inset-[5%] md:rounded-3xl"
    >
      <HoldingModalHeader
        holding={holding}
        afterName={privacy.enabled && <PrivacyEye size="sm" masked={masked} toggle={privacy.toggle} />}
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

      {/* Body */}
      <div data-modal-body className="flex flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0 md:p-6 md:pt-0">
        {/* Side by side from lg; below, the chart on top and the stats under it. */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        {/* Left column */}
        <div className="flex min-w-0 flex-col rounded-2xl bg-surface-2 p-4 md:p-5 lg:flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-fg-faint text-sm">{chartLabel}</span>
              {/* Both headerValue and gainAbs follow the chart: price
                  domain in asset mode, amount domain in purchases mode.
                  Reporting currency only behind the unit switch — see the file header. */}
              <MaskedMoney
                masked={masked && mode === "purchases"}
                value={headerValue}
                currency={shownCurrency}
                className="text-fg text-2xl font-semibold tracking-tight"
              />
              <div
                className={`flex self-start items-center gap-1 py-1 px-2 rounded-lg text-sm ${
                  gainUp ? "bg-green-soft text-green" : "bg-red-soft text-red"
                }`}
              >
                {gainUp ? (
                  <ArrowUpRight className="size-4" />
                ) : (
                  <ArrowDownRight className="size-4" />
                )}
                <MaskedMoney
                  masked={masked && mode === "purchases"}
                  value={gainAbs}
                  currency={shownCurrency}
                  signed
                />
                <span className="font-mono ml-2">
                  (<Percent value={gainPct} signed />)
                </span>
              </div>
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
              className="mt-4"
              currency={shownCurrency}
            />
          ) : (
            <CardState
              variant={chartError ? "error" : "loading"}
              onRetry={retryChart}
              className="mt-4 h-85"
            />
          )}

          <div className="mt-3 flex justify-center overflow-x-auto">
            <SegmentedControl
              value={range}
              onChange={(v) => setRange(v as Range)}
              options={rangeOptions(t)}
            />
          </div>
        </div>

        {/* Right column */}
        <div className="flex w-full flex-col gap-4 lg:w-lg lg:shrink-0">
          <StatsSurface
            holding={holding}
            meanPrice={meanPrice}
            up={up}
            masked={masked}
          />
          {mode === "asset" ? (
            <AboutSurface holding={holding} netWorth={netWorth} />
          ) : (
            <PurchaseHistorySurface
              purchases={purchases}
              currency={holding.accountCurrency}
              masked={masked}
              ready={txnData !== undefined}
              isError={txnError}
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
        </div>{/* end chart row */}

        {mode === "asset" && holding.composition && (
          <CompositionSurface composition={holding.composition} />
        )}
      </div>{/* end body */}
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
  meanPrice: number;
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
          {/* No rate: the converted value is zero, so show what it is worth
              in its own currency, marked, as the Holdings table does. */}
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
        <AboutRow label={t("dashboard.assetModal.type")}>{t(KIND_LABEL_KEY[holding.kind])}</AboutRow>
        <AboutRow label={t("dashboard.assetModal.account")}>
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: holding.accountColor }}
            />
            <span className="truncate">{holding.accountName}</span>
          </span>
        </AboutRow>
        <AboutRow label={t("dashboard.assetModal.weightOfNetWorth")}>
          {/* Left out of the net worth for want of a rate: no share of it. */}
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

// The purchase history's columns: date with the side, quantity, unit price,
// cash amount. Fixed tracks like every grid table (see `gridTable.ts`).
const HISTORY_TRACKS = "minmax(150px, 1fr) minmax(64px, max-content) minmax(96px, max-content) minmax(108px, max-content)";

/// `currency` is the ACCOUNT's currency: transaction.amount and
/// transaction.unit_price are amount-domain, not price-domain.
function PurchaseHistorySurface({
  purchases,
  currency,
  masked,
  ready,
  isError,
  onRetry,
}: {
  purchases: Lot[];
  currency: string;
  masked: boolean;
  ready: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <h3 className="text-fg font-semibold text-sm">{t("dashboard.assetModal.purchaseHistory")}</h3>
      {!ready ? (
        <CardState
          variant={isError ? "error" : "loading"}
          onRetry={onRetry}
          className="mt-4 h-32"
        />
      ) : purchases.length === 0 ? (
        <p className="text-fg-faint text-sm mt-4">{t("dashboard.assetModal.noPurchases")}</p>
      ) : (
        <div className="mt-3 -mx-3">
          <GridTable
            columns={HISTORY_TRACKS}
            minWidth="26rem"
            head={
              <>
                <th role="columnheader" className={`${HEAD_CELL} pl-3 pr-4`}>{t("dashboard.assetModal.columns.date")}</th>
                <th role="columnheader" className={`${HEAD_CELL} justify-end pr-4`}>{t("dashboard.assetModal.columns.qty")}</th>
                <th role="columnheader" className={`${HEAD_CELL} justify-end pr-4`}>{t("dashboard.assetModal.columns.price")}</th>
                <th role="columnheader" className={`${HEAD_CELL} justify-end pr-3`}>{t("dashboard.assetModal.columns.amount")}</th>
              </>
            }
          >
            {purchases.map((p) => {
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
                    {/* Same convention as the transactions ledger and
                        RecordLotsModal: a buy is negative (cash out, fee
                        included), a sale is positive (cash in, net of fee). Plain
                        cash arithmetic, not the cost-basis rule. */}
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
