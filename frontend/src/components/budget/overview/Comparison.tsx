import { ArrowDownRight, ArrowUpRight, Dot } from "lucide-react";

import { Money } from "../../Money";
import { Percent } from "../../Percent";
import { TONE_CLASS, compareToBaseline } from "../../../lib/comparison";

type ComparisonProps = {
  /** "vs previous month" / "vs 12-month average". */
  label: string;
  /** The figure's own amount, as the API sent it. */
  current: string;
  /** The baseline. ABSENT (undefined) means this comparison does not exist for
   *  this figure and nothing renders — never `null`, never a dash. */
  baseline?: string;
  /** Percent for the always-positive magnitudes, absolute for the signed ones.
   *  Fixed per figure, so a cell never changes shape month to month. */
  format: "percent" | "absolute";
  /** Which direction reads as good: `up` for income, net and saved; `down` for
   *  expenses, where spending less is the improvement. */
  goodWhen: "up" | "down";
  /** Completes `cmp-<figure>-<key>` for the test hooks. */
  testId: string;
};

export function Comparison({
  label, current, baseline, format, goodWhen, testId,
}: ComparisonProps) {
  if (baseline === undefined) return null;

  const { tone, direction, delta, ratio } = compareToBaseline(current, baseline, goodWhen);
  const Icon = direction === "flat" ? Dot : direction === "up" ? ArrowUpRight : ArrowDownRight;
  // Without a ratio (a zero baseline) the absolute delta is the only honest
  // thing to show.
  const asPercent = format === "percent" && ratio !== undefined;

  return (
    // `contents`: the delta and the label are the two cells of the parent's
    // two-column grid, so every "vs …" label in a figure starts at the same x
    // however wide the delta beside it is.
    <span data-testid={testId} data-tone={tone} className="contents text-xs">
      <span className={`flex items-center gap-0.5 ${TONE_CLASS[tone]}`}>
        <Icon className="size-3.5 shrink-0" />
        {asPercent ? (
          <Percent value={ratio} signed />
        ) : (
          <Money value={delta} signed />
        )}
      </span>
      <span className="truncate text-fg-faint">{label}</span>
    </span>
  );
}
