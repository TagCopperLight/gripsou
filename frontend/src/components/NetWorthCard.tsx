import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { NetWorthChart } from "./NetWorthChart";
import { ChartLegend } from "./ChartLegend";
import { CardState } from "./CardState";
import type { ChartUnit } from "./ValueChart";
import { useNetWorth } from "../api/hooks";
import { getPrefs } from "../lib/prefs";
import { currencySymbol } from "../lib/currency";

const RANGE_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "1mo", label: "1mo" },
  { value: "6mo", label: "6mo" },
  { value: "1y", label: "1y" },
  { value: "ytd", label: "ytd" },
  { value: "max", label: "max" },
];

const RANGE_LABEL: Record<string, string> = {
  "24h": "24h", "7d": "7d", "1mo": "1mo", "6mo": "6mo", "1y": "1y", ytd: "ytd", max: "max",
};

export function NetWorthCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState("6mo");
  const [unit, setUnit] = useState<ChartUnit>("value");
  const { data, isError, refetch } = useNetWorth(range);
  const ready = data !== undefined;

  const UNIT_OPTIONS = [
    { value: "value", label: t("common.value") },
    { value: "percent", label: "%" },
  ];

  // Phone: the word "Value" costs more width than it earns next to "%".
  const UNIT_OPTIONS_SHORT = [
    { value: "value", label: currencySymbol(getPrefs().currency) },
    { value: "percent", label: "%" },
  ];

  const LEGEND_ITEMS = [
    { label: t("dashboard.netWorth.netWorth"), color: "var(--color-green)" },
    { label: t("dashboard.netWorth.capitalInvested"), color: "var(--color-fg-faint)", dashed: true },
  ];

  const points = (data?.points ?? []).map((p) => ({
    t: p.t,
    netWorth: Number(p.netWorth),
    invested: Number(p.invested),
  }));
  const summary = data?.summary;
  const gainUp = summary ? Number(summary.gainAbs) >= 0 : true;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:justify-between md:gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-fg font-semibold text-sm">{t("dashboard.netWorth.title")}</p>
              <SegmentedControl
                options={UNIT_OPTIONS_SHORT}
                value={unit}
                onChange={(v) => setUnit(v as ChartUnit)}
                className="md:hidden"
              />
            </div>
            {ready && (
              <>
                {/* The dashboard's single biggest number, and the only place
                    that can silently omit a zeroed holding — so it carries the
                    same warning treatment as the holdings/accounts cards. */}
                <span className="flex items-baseline gap-2">
                  <Money value={summary?.netWorth ?? "0"} className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]" />
                  {summary?.fxMissing && (
                    <span
                      title={t("dashboard.fxMissing")}
                      className="text-fg-faint text-sm"
                      aria-label={t("dashboard.fxMissing")}
                    >
                      ⚠
                    </span>
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className={`flex self-start items-center gap-1 whitespace-nowrap py-1 px-2 rounded-lg text-sm ${gainUp ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                    {gainUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    <Money value={summary?.gainAbs ?? "0"} signed />
                    <span className="font-mono ml-2">(<Percent value={summary?.gainPct ?? "0"} signed />)</span>
                  </div>
                  <p className="text-fg-faint text-sm">{t("dashboard.netWorth.over", { range: RANGE_LABEL[range] })}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 md:gap-3">
            <div className="hidden items-center gap-6 md:flex">
              <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} />
              <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={(v) => setUnit(v as ChartUnit)} />
            </div>
            <ChartLegend items={LEGEND_ITEMS} className="md:self-end" />
          </div>
        </div>
        {/* Phone: the seven ranges scroll on their own row under the chart. */}
        <div className="order-last -mx-1 mt-3 flex justify-center-safe overflow-x-auto px-1 md:hidden">
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} className="w-max" />
        </div>
        {ready ? (
          <NetWorthChart className="mt-4" data={points} unit={unit} />
        ) : (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => refetch()}
            className="mt-4 h-80"
          />
        )}
      </div>
    </Surface>
  );
}
