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

  const LEGEND_ITEMS = [
    { label: t("netWorth.netWorth"), color: "var(--color-green)" },
    { label: t("netWorth.capitalInvested"), color: "var(--color-fg-faint)", dashed: true },
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
      <div className="flex flex-col p-5">
        <div className="flex justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-fg font-semibold text-sm">{t("netWorth.title")}</p>
            {ready && (
              <>
                <Money value={summary?.netWorth ?? "0"} className="text-[40px] font-semibold tracking-tight" />
                <div className="flex items-center gap-4">
                  <div className={`flex self-start items-center gap-1 py-1 px-2 rounded-lg text-sm ${gainUp ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                    {gainUp ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
                    <Money value={summary?.gainAbs ?? "0"} signed />
                    <span className="font-mono ml-2">(<Percent value={summary?.gainPct ?? "0"} signed />)</span>
                  </div>
                  <p className="text-fg-faint text-sm">{t("netWorth.over", { range: RANGE_LABEL[range] })}</p>
                </div>
              </>
            )}
          </div>
          <div className="flex flex-col">
            <div>
              <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={setRange} className="mr-6" />
              <SegmentedControl options={UNIT_OPTIONS} value={unit} onChange={(v) => setUnit(v as ChartUnit)} />
            </div>
            <ChartLegend className="mt-3 self-end" items={LEGEND_ITEMS} />
          </div>
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
