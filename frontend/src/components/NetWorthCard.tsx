import { ArrowUpRight } from "lucide-react";

import { Surface } from "./Surface";
import { Money } from "./Money";
import { Percent } from "./Percent";
import { SegmentedControl } from "./SegmentedControl";
import { NetWorthChart } from "./NetWorthChart";
import { ChartLegend } from "./ChartLegend";

const RANGE_OPTIONS = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "1m", label: "1mo" },
  { value: "6m", label: "6mo" },
  { value: "1y", label: "1y" },
  { value: "ytd", label: "ytd" },
  { value: "max", label: "max" },
];

const UNIT_OPTIONS = [
  { value: "value", label: "Value" },
  { value: "percent", label: "%" },
];

const LEGEND_ITEMS = [
  { label: "Net worth", color: "var(--color-green)" },
  { label: "Capital invested", color: "var(--color-fg-faint)", dashed: true },
];

function NetWorthGain() {
  return (
    <div className="flex items-center gap-4">
      <div className="flex self-start items-center gap-1 py-1 px-2 rounded-lg bg-green-soft text-green text-sm">
        <ArrowUpRight className="size-4" />
        <Money value="22048.02" signed={true} />
        <span className="font-mono">
          (<Percent value="0.134" signed={true} />)
        </span>
      </div>
      <p className="text-fg-faint text-sm">over 6mo</p>
    </div>
  );
}

type NetWorthCardProps = {
  className?: string;
};

export function NetWorthCard({ className = "" }: NetWorthCardProps) {
  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-5">
        <div className="flex justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-fg font-semibold text-sm">Net Worth</p>
            <Money
              value="186847.65"
              className="text-[40px] font-semibold tracking-tight"
            />
            <NetWorthGain />
          </div>
          <div className="flex flex-col">
            <div>
              <SegmentedControl options={RANGE_OPTIONS} className="mr-6" />
              <SegmentedControl options={UNIT_OPTIONS} />
            </div>
            <ChartLegend className="mt-3 self-end" items={LEGEND_ITEMS} />
          </div>
        </div>
        <NetWorthChart className="mt-4" />
      </div>
    </Surface>
  );
}
