import { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, X } from "lucide-react";

import { Money } from "./Money";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { ChartLegend } from "./ChartLegend";
import { ValueChart, type ChartSeries, type ChartUnit } from "./ValueChart";
import { formatMoney, formatQuantity } from "../lib/money";
import { formatDate } from "../lib/date";
import { KIND_LABEL, type Holding } from "../lib/fakeHoldings";
import {
  RANGES,
  assetPriceSeries,
  positionValueSeries,
  purchaseHistory,
} from "../lib/fakeAsset";

const GREEN = "var(--color-green)";
const FAINT = "var(--color-fg-faint)";

type Mode = "asset" | "purchases";

const RANGE_OPTIONS = RANGES.map((r) => ({ value: r.key, label: r.label }));

const UNIT_OPTIONS = [
  { value: "value", label: "Value" },
  { value: "percent", label: "%" },
];

type AssetModalProps = {
  holding: Holding;
  /** Total net worth, for the "weight of net worth" stat. */
  netWorth: number;
  onClose: () => void;
};

export function AssetModal({ holding, netWorth, onClose }: AssetModalProps) {
  const [mode, setMode] = useState<Mode>("asset");
  const [range, setRange] = useState("1mo");
  const [unit, setUnit] = useState<ChartUnit>("value");

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

  const purchases = useMemo(() => purchaseHistory(holding), [holding]);
  const meanPrice = holding.qty ? holding.invested / holding.qty : 0;
  const up = holding.gl >= 0;

  // Chart series + header figures depend on the mode and range.
  const { series, headerValue, gainAbs, gainPct, chartLabel } = useMemo(() => {
    if (mode === "asset") {
      const pts = assetPriceSeries(holding, range);
      const values = pts.map((p) => p.price);
      const first = values[0];
      const last = values[values.length - 1];
      return {
        series: [
          {
            name: "Unit price",
            data: pts.map((p) => [p.t, p.price] as [number, number]),
            color: holding.accountColor,
            area: true,
          },
        ] satisfies ChartSeries[],
        headerValue: holding.price,
        gainAbs: last - first,
        gainPct: first ? (last - first) / first : 0,
        chartLabel: "Unit price",
      };
    }
    const pts = positionValueSeries(holding, range);
    const values = pts.map((p) => p.value);
    const first = values[0];
    const last = values[values.length - 1];
    return {
      series: [
        {
          name: "Invested",
          data: pts.map((p) => [p.t, p.invested] as [number, number]),
          color: "#777471",
          dashed: true,
        },
        {
          name: "Position value",
          data: pts.map((p) => [p.t, p.value] as [number, number]),
          color: "#34d399",
          area: true,
        },
      ] satisfies ChartSeries[],
      headerValue: holding.value,
      gainAbs: last - first,
      gainPct: first ? (last - first) / first : 0,
      chartLabel: "Position value",
    };
  }, [holding, mode, range]);

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
            <span
              className="size-12 rounded-xl shrink-0 flex items-center justify-center text-sm font-mono font-semibold text-fg"
              style={{ background: holding.logo }}
            >
              {holding.ticker.slice(0, 2)}
            </span>
            <div className="h-12 flex flex-col justify-between py-0.5">
              <h2 className="text-xl font-semibold text-fg leading-none">
                {holding.name}
              </h2>
              <div className="flex items-center gap-2 text-sm leading-none">
                <span className="font-mono text-fg-faint">{holding.ticker} · </span>
                <span className="font-mono text-[11px] text-fg-faint bg-surface-3 rounded px-1.5 py-0.5">
                  {holding.category}
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
                { value: "asset", label: "Asset" },
                { value: "purchases", label: "Purchases" },
              ]}
            />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-fg-faint hover:bg-surface-2 hover:text-fg transition-colors duration-140 cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 pt-0 flex gap-4 items-start">
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
                      { label: "Position value", color: GREEN },
                      { label: "Invested", color: FAINT, dashed: true },
                    ]}
                  />
                )}
              </div>
            </div>

            <ValueChart
              series={series}
              unit={unit}
              height={340}
              className="mt-4"
            />

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
              <PurchaseHistorySurface purchases={purchases} />
            )}
          </div>
        </div>
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
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <div className="grid grid-cols-2 gap-y-4 gap-x-6">
        <Stat label="Quantity owned" value={formatQuantity(holding.qty)} />
        <Stat label="Mean price / share" value={formatMoney(meanPrice)} />
        <Stat label="Capital invested" value={formatMoney(holding.invested)} />
        <Stat label="Current value" value={formatMoney(holding.value)} />
      </div>
      <hr className="border-surface-3 my-4" />
      <div className="flex flex-col items-start gap-1">
        <span className="text-fg-faint text-xs">Total unrealized P/L</span>
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
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <span className="text-fg text-sm font-semibold">About</span>
      <div className="mt-1 divide-y divide-surface-3">
        <AboutRow label="Type">{KIND_LABEL[holding.kind]}</AboutRow>
        <AboutRow label="Account">
          <span className="flex items-center gap-2">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: holding.accountColor }}
            />
            {holding.accountName}
          </span>
        </AboutRow>
        <AboutRow label="Weight of net worth">
          <Percent
            value={netWorth ? holding.value / netWorth : 0}
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
}: {
  purchases: ReturnType<typeof purchaseHistory>;
}) {
  return (
    <div className="bg-surface-2 rounded-2xl p-5">
      <h3 className="text-fg font-semibold text-sm">Purchase history</h3>
      {purchases.length === 0 ? (
        <p className="text-fg-faint text-sm mt-4">No purchases.</p>
      ) : (
        <table className="w-full mt-3 border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] font-mono text-fg-faint">
              <th className="text-left font-medium pb-2">DATE</th>
              <th className="text-right font-medium pb-2">QTY</th>
              <th className="text-right font-medium pb-2">PRICE</th>
              <th className="text-right font-medium pb-2">INVESTED</th>
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
