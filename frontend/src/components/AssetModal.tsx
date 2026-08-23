import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";

import { Money } from "./Money";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { ChartLegend } from "./ChartLegend";
import { ValueChart, type ChartSeries, type ChartUnit } from "./ValueChart";
import { CardState } from "./CardState";
import { CompositionSurface } from "./CompositionSurface";
import { HoldingModalHeader } from "./HoldingModalHeader";
import { IncompleteHistoryStrip } from "./IncompleteHistoryStrip";
import { formatMoney, formatQuantity } from "../lib/money";
import { formatDate } from "../lib/date";
import { colorForString } from "../lib/palette";
import { KIND_LABEL_KEY, type Holding, type Purchase } from "../api/types";
import { useHoldingPrices, useHoldingTransactions } from "../api/hooks";
import { positionSeries } from "../lib/assetSeries";

// This modal shows THREE currency domains on screen. They are distinct and must
// never be collapsed into one "native" currency:
//
// - Reporting domain (`users.prefs.currency`, so no explicit `currency` option):
//   capitalInvested, currentValue, total unrealized P/L, weight of net worth.
// - Price domain (`holding.priceCurrency` — the currency stamped on the `price`
//   ROW we read, which is NOT necessarily `holding.currency`; Powens may label
//   an instrument EUR while Yahoo resolves a London listing quoted GBP): the
//   left chart panel's header figure and gain, and the chart itself.
// - Amount domain (`holding.accountCurrency`): everything the provider
//   denominated in the account — mean price per share (it is
//   investedNative / qty, a cost-basis figure, NOT a market price) and the
//   purchase-history table's price/invested columns (transaction.amount and
//   transaction.unit_price are amount-domain).
//
// `holding.currency` is the instrument's QUOTE currency. It labels the asset's
// identity, not any amount here, so it formats nothing on this screen.
//
// Caveat, deliberately left as-is: in purchases mode the chart overlays a
// position-value series (price domain) on an invested series (amount domain).
// Those coincide for the common case where the account and the listing share a
// currency, and the chart is labelled with the price domain because the value
// series is the one that moves. Splitting them needs a per-transaction FX rate
// the provider does not give us.
// Never mix the domains without labeling — an unlabelled figure sitting next to
// one in another currency is the bug this split exists to prevent.

// Range buttons for the modal (canonical API keys).
const RANGES = [
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "1mo", label: "1mo" },
  { key: "6mo", label: "6mo" },
  { key: "1y", label: "1y" },
  { key: "ytd", label: "ytd" },
  { key: "max", label: "max" },
];

const GREEN = "var(--color-green)";
const FAINT = "var(--color-fg-faint)";

type Mode = "asset" | "purchases";

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.key, label: r.label }));

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
  const [range, setRange] = useState("1mo");
  const [unit, setUnit] = useState<ChartUnit>("value");

  const UNIT_OPTIONS = [
    { value: "value", label: t("common.value") },
    { value: "percent", label: "%" },
  ];

  // Close on Escape; lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const { data: priceData, isError: pricesError, refetch: refetchPrices } =
    useHoldingPrices(holding.id, range);
  const { data: txnData, isError: txnError, refetch: refetchTxn } =
    useHoldingTransactions(holding.id);
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
  // Cost basis / quantity — an AMOUNT-domain figure (account currency), not a
  // market price. It is labelled with accountCurrency below, never with the
  // price row's or the instrument's currency.
  const meanPrice = qtyNum === 0 ? 0 : Number(holding.investedNative) / qtyNum;
  const up = Number(holding.gl) >= 0;

  // Chart series + header figures depend on the mode and range.
  const { series, headerValue, gainAbs, gainPct, chartLabel } = useMemo(() => {
    if (mode === "asset") {
      const values = prices.map((p) => Number(p.price));
      const first = values[0] ?? 0;
      const last = values[values.length - 1] ?? 0;
      return {
        series: [
          {
            name: t("dashboard.assetModal.unitPrice"),
            data: prices.map((p) => [p.t, Number(p.price)] as [number, number]),
            color: colorForString(holding.ticker),
            area: true,
          },
        ] satisfies ChartSeries[],
        headerValue: Number(holding.price),
        gainAbs: last - first,
        gainPct: first ? (last - first) / first : 0,
        chartLabel: t("dashboard.assetModal.unitPrice"),
      };
    }
    const pts = positionSeries(prices, purchases, qtyNum, investedNum);
    const values = pts.map((p) => p.value);
    const first = values[0] ?? 0;
    const last = values[values.length - 1] ?? 0;
    return {
      series: [
        { name: t("dashboard.assetModal.invested"), data: pts.map((p) => [p.t, p.invested] as [number, number]), color: "#777471", dashed: true },
        { name: t("dashboard.assetModal.positionValue"), data: pts.map((p) => [p.t, p.value] as [number, number]), color: "#34d399", area: true },
      ] satisfies ChartSeries[],
      // The chart's own last point, not `holding.value`: this series is
      // price-domain (unit prices x quantity), so the header must read in the
      // same currency as the axis beneath it — not the reporting currency.
      headerValue: last,
      gainAbs: last - first,
      gainPct: first ? (last - first) / first : 0,
      chartLabel: t("dashboard.assetModal.positionValue"),
    };
  }, [holding, mode, prices, purchases, qtyNum, investedNum, t]);

  const gainUp = gainAbs >= 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-[5%] bg-surface rounded-3xl flex flex-col overflow-hidden"
      >
        <HoldingModalHeader holding={holding}>
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
        <div className="flex-1 overflow-y-auto p-6 pt-0 flex flex-col gap-4">
          <div className="flex gap-4 items-start">
          {/* Left column */}
          <div className="flex-1 min-w-0 bg-surface-2 rounded-2xl p-5 flex flex-col">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-fg-faint text-sm">{chartLabel}</span>
                {/* Both headerValue and gainAbs follow the chart, which is
                    price-domain in both modes: unit prices in asset mode, and
                    unit prices x quantity in purchases mode. Never reporting
                    currency — see the file header. */}
                <Money
                  value={headerValue}
                  currency={holding.priceCurrency}
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
                  <Money
                    value={gainAbs}
                    currency={holding.priceCurrency}
                    signed
                  />
                  <span className="font-mono ml-2">
                    (<Percent value={gainPct} signed />)
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-3">
                <SegmentedControl
                  value={unit}
                  onChange={(v) => setUnit(v as ChartUnit)}
                  options={UNIT_OPTIONS}
                />
                {mode === "purchases" && (
                  <ChartLegend
                    items={[
                      { label: t("dashboard.assetModal.positionValue"), color: GREEN },
                      { label: t("dashboard.assetModal.invested"), color: FAINT, dashed: true },
                    ]}
                  />
                )}
              </div>
            </div>

            {chartReady ? (
              <ValueChart
                series={series}
                unit={unit}
                height={340}
                className="mt-4"
                currency={holding.priceCurrency}
              />
            ) : (
              <CardState
                variant={chartError ? "error" : "loading"}
                onRetry={retryChart}
                className="mt-4 h-85"
              />
            )}

            <div className="flex justify-center mt-3">
              <SegmentedControl
                value={range}
                onChange={setRange}
                options={RANGE_OPTIONS}
              />
            </div>
          </div>

          {/* Right column */}
          <div className="w-lg shrink-0 flex flex-col gap-4">
            <StatsSurface
              holding={holding}
              meanPrice={meanPrice}
              up={up}
            />
            {mode === "asset" ? (
              <AboutSurface holding={holding} netWorth={netWorth} />
            ) : (
              <PurchaseHistorySurface
                purchases={purchases}
                currency={holding.accountCurrency}
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
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-faint text-xs">{label}</span>
      <span className="text-fg font-mono font-semibold text-sm">{value}</span>
    </div>
  );
}

function StatsSurface({
  holding,
  meanPrice,
  up,
}: {
  holding: Holding;
  meanPrice: number;
  up: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <div className="grid grid-cols-2 gap-y-4 gap-x-6">
        <Stat label={t("dashboard.assetModal.quantityOwned")} value={formatQuantity(holding.qty)} />
        <Stat
          label={t("dashboard.assetModal.meanPricePerShare")}
          value={formatMoney(meanPrice, { currency: holding.accountCurrency })}
        />
        <Stat label={t("dashboard.assetModal.capitalInvested")} value={formatMoney(holding.invested)} />
        <Stat label={t("dashboard.assetModal.currentValue")} value={formatMoney(holding.value)} />
      </div>
      <hr className="border-surface-3 my-4" />
      <div className="flex flex-col items-start gap-1">
        <span className="text-fg-faint text-xs">{t("dashboard.assetModal.totalUnrealizedPnl")}</span>
        <div className="flex items-baseline gap-2">
          <Money
            value={holding.gl}
            signed
            className={`text-base font-semibold ${up ? "text-green" : "text-red"}`}
          />
          <span className={`font-mono text-base ml-2 ${up ? "text-green" : "text-red"}`}>
            (<Percent value={holding.glPct} signed />)
          </span>
        </div>
      </div>
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
    <div className="flex items-center justify-between py-2.5">
      <span className="text-fg-faint text-sm">{label}</span>
      <span className="text-fg text-sm">{children}</span>
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
          <span className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: holding.accountColor }}
            />
            {holding.accountName}
          </span>
        </AboutRow>
        <AboutRow label={t("dashboard.assetModal.weightOfNetWorth")}>
          <Percent
            value={netWorth ? Number(holding.value) / netWorth : 0}
            fractionDigits={1}
            className="text-fg"
          />
        </AboutRow>
      </div>
    </div>
  );
}

/// `currency` is the ACCOUNT's currency: transaction.amount and
/// transaction.unit_price are amount-domain, not price-domain.
function PurchaseHistorySurface({
  purchases,
  currency,
  ready,
  isError,
  onRetry,
}: {
  purchases: Purchase[];
  currency: string;
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
        <table className="w-full mt-3 border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] font-mono text-fg-faint">
              <th className="text-left font-medium pb-2">{t("dashboard.assetModal.columns.date")}</th>
              <th className="text-right font-medium pb-2">{t("dashboard.assetModal.columns.qty")}</th>
              <th className="text-right font-medium pb-2">{t("dashboard.assetModal.columns.price")}</th>
              <th className="text-right font-medium pb-2">{t("dashboard.assetModal.columns.invested")}</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((p, i) => (
              <tr key={i} className="font-mono text-sm">
                <td className="py-2 border-t border-surface-3 text-fg-dim">
                  {formatDate(p.t)}
                </td>
                <td className="py-2 border-t border-surface-3 text-right text-fg-dim">
                  {formatQuantity(p.qty)}
                </td>
                <td className="py-2 border-t border-surface-3 text-right text-fg-dim">
                  {formatMoney(p.price, { currency })}
                </td>
                <td className="py-2 border-t border-surface-3 text-right text-fg">
                  {/* Raw `transaction.amount`, negated: positive means money
                      went in (a buy), negative means it came back out (a sale). */}
                  {formatMoney(-Number(p.invested), { currency })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
