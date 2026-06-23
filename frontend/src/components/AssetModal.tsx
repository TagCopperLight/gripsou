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
import { HoldingBadge } from "./HoldingBadge";
import { formatMoney, formatQuantity } from "../lib/money";
import { formatDate } from "../lib/date";
import { colorForString } from "../lib/palette";
import { KIND_LABEL_KEY, categoryLabel, type Holding, type Purchase } from "../api/types";
import { useHoldingPrices, useHoldingTransactions } from "../api/hooks";
import { positionSeries } from "../lib/assetSeries";

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
};

export function AssetModal({ holding, netWorth, onClose }: AssetModalProps) {
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
  const investedNum = Number(holding.invested);
  const meanPrice = qtyNum ? investedNum / qtyNum : 0;
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
      headerValue: Number(holding.value),
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
        {/* Header */}
        <div className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <HoldingBadge
              logo={holding.logo}
              ticker={holding.ticker}
              className="size-12 rounded-xl text-sm"
            />
            <div className="h-12 flex flex-col justify-between py-0.5">
              <h2 className="text-xl font-semibold text-fg leading-none">
                {holding.name}
              </h2>
              <div className="flex items-center gap-2 text-sm leading-none">
                <span className="font-mono text-fg-faint">{holding.ticker} · </span>
                <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
                  {categoryLabel(t, holding.category, holding.categoryLabel)}
                </span>
                <span className="font-mono text-fg-faint"> · </span>
                <span className="flex items-center gap-1.5 text-fg-dim">
                  <span
                    className="size-2.5 rounded-sm"
                    style={{ background: holding.accountColor }}
                  />
                  {holding.accountName}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 pt-0 flex flex-col gap-4">
          <div className="flex gap-4 items-start">
          {/* Left column */}
          <div className="flex-1 min-w-0 bg-surface-2 rounded-2xl p-5 flex flex-col">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-fg-faint text-sm">{chartLabel}</span>
                <Money
                  value={headerValue}
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
                  <Money value={gainAbs} signed />
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
                ready={txnData !== undefined}
                isError={txnError}
                onRetry={() => refetchTxn()}
              />
            )}
          </div>
          </div>{/* end chart row */}

          {holding.composition && (
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
        <Stat label={t("dashboard.assetModal.meanPricePerShare")} value={formatMoney(meanPrice)} />
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

function PurchaseHistorySurface({
  purchases,
  ready,
  isError,
  onRetry,
}: {
  purchases: Purchase[];
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
                  {formatMoney(p.price)}
                </td>
                <td className="py-2 border-t border-surface-3 text-right text-fg">
                  {formatMoney(p.invested)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
