import { ArrowDownRight, ArrowUpRight, Dot } from "lucide-react";

import { MaskedMoney } from "../../../ui/MaskedMoney";
import { Percent } from "../../../ui/Percent";
import { TONE_CLASS, compareToBaseline } from "../../../lib/comparison";

type ComparisonProps = {
  label: string;
  current: string;
  /** Undefined: no such comparison for this figure, nothing renders. */
  baseline?: string;
  /** Fixed per figure so a cell never changes shape between months. */
  format: "percent" | "absolute";
  /** `down` for expenses, where spending less is the improvement. */
  goodWhen: "up" | "down";
  testId: string;
  masked?: boolean;
};

export function Comparison({
  label, current, baseline, format, goodWhen, testId, masked = false,
}: ComparisonProps) {
  if (baseline === undefined) return null;

  const { tone, direction, delta, ratio } = compareToBaseline(current, baseline, goodWhen);
  const Icon = direction === "flat" ? Dot : direction === "up" ? ArrowUpRight : ArrowDownRight;
  const asPercent = format === "percent" && ratio !== undefined;

  return (
    // `contents`: delta and label are cells of the parent's grid, so every "vs" label starts at the same x.
    <span data-testid={testId} data-tone={tone} className="contents text-xs">
      <span className={`flex items-center gap-0.5 ${TONE_CLASS[tone]}`}>
        <Icon className="size-3.5 shrink-0" />
        {asPercent ? (
          <Percent value={ratio} signed />
        ) : (
          <MaskedMoney masked={masked} value={delta} signed />
        )}
      </span>
      <span className="truncate text-fg-faint">{label}</span>
    </span>
  );
}
