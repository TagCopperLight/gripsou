import { subtractDecimals } from "./decimal";

export type Change = {
  /** A move under half a cent is no move at the precision shown. */
  tone: "good" | "bad" | "flat";
  direction: "up" | "down" | "flat";
  delta: string;
  ratio?: number;
};

export function compareToBaseline(
  current: string,
  baseline: string,
  goodWhen: "up" | "down",
): Change {
  const delta = subtractDecimals(current, baseline);
  // `Number` serves the sign, the flat test and the ratio only; the rendered amount is `delta`, the exact string.
  const d = Number(delta);
  const direction = Math.abs(d) < 0.005 ? "flat" : d > 0 ? "up" : "down";
  const tone = direction === "flat" ? "flat" : direction === goodWhen ? "good" : "bad";
  const base = Number(baseline);
  return { tone, direction, delta, ...(base === 0 ? {} : { ratio: d / Math.abs(base) }) };
}

export const TONE_CLASS: Record<Change["tone"], string> = {
  good: "text-green",
  bad: "text-red",
  flat: "text-fg-faint",
};
