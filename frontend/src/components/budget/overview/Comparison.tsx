import { ArrowDownRight, ArrowUpRight, Dot } from "lucide-react";

import { Money } from "../../Money";
import { Percent } from "../../Percent";

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

const TONE = {
  good: "text-green",
  bad: "text-red",
  flat: "text-fg-faint",
} as const;

export function Comparison({
  label, current, baseline, format, goodWhen, testId,
}: ComparisonProps) {
  if (baseline === undefined) return null;

  const base = Number(baseline);
  // `Number` is used for the DELTA and the RATIO only — both are derived
  // display values. The amounts themselves are still rendered from the strings
  // the server sent, through the money formatter.
  const delta = Number(current) - base;

  // Below half a cent is no change at the precision anything here is shown at.
  const flat = Math.abs(delta) < 0.005;
  const up = delta > 0;
  const tone = flat ? "flat" : (up ? "up" : "down") === goodWhen ? "good" : "bad";

  const Icon = flat ? Dot : up ? ArrowUpRight : ArrowDownRight;

  // A percentage needs a non-zero base; with one the absolute delta is the only
  // honest thing to show.
  const asPercent = format === "percent" && base !== 0;

  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`flex items-center gap-0.5 text-xs ${TONE[tone]}`}
    >
      <Icon className="size-3.5 shrink-0" />
      {asPercent ? (
        <Percent value={delta / Math.abs(base)} signed />
      ) : (
        <Money value={String(delta)} signed />
      )}
      <span className="ml-1 truncate text-fg-faint">{label}</span>
    </span>
  );
}
