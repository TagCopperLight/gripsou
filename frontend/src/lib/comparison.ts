import { subtractDecimals } from "./money";

/** How a figure moved against a baseline, by the one rule set every "vs …"
 *  cell on the Overview uses. */
export type Change = {
  /** Whether the move reads as an improvement. A move under half a cent is
   *  no move at the precision anything here is shown at. */
  tone: "good" | "bad" | "flat";
  direction: "up" | "down" | "flat";
  /** `current - baseline`, as an exact decimal string: what renders when the
   *  change is shown as an amount. */
  delta: string;
  /** The change as a fraction of the baseline. Absent on a zero baseline,
   *  where a percentage means nothing and only the amount is honest. */
  ratio?: number;
};

/** `goodWhen` is the direction that reads as an improvement: `up` for income,
 *  net; `down` for spending. */
export function compareToBaseline(
  current: string,
  baseline: string,
  goodWhen: "up" | "down",
): Change {
  const delta = subtractDecimals(current, baseline);
  // `Number` for the sign, the flat test and the ratio only — derived display
  // values. The rendered amount is `delta`, the exact string.
  const d = Number(delta);
  const direction = Math.abs(d) < 0.005 ? "flat" : d > 0 ? "up" : "down";
  const tone = direction === "flat" ? "flat" : direction === goodWhen ? "good" : "bad";
  const base = Number(baseline);
  return { tone, direction, delta, ...(base === 0 ? {} : { ratio: d / Math.abs(base) }) };
}

/** The text colour of each tone, shared by every comparison cell. */
export const TONE_CLASS: Record<Change["tone"], string> = {
  good: "text-green",
  bad: "text-red",
  flat: "text-fg-faint",
};
