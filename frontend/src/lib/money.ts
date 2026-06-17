// Money/quantities arrive from the API as decimal strings (never floats — see
// CLAUDE.md). We use Intl.NumberFormat (en-US, predictable part types) only for
// digit grouping + rounding structure, then substitute the user's independent
// separators / currency symbol from prefs. This supports free-form combinations
// (e.g. US dates + French separators + symbol-after) that a single locale can't.

import { getPrefs } from "./prefs";

type SignOption = {
  /** Prefix with + (positive) / - (negative). Zero stays unsigned. */
  signed?: boolean;
};

type SepOptions = {
  /** Thousands group separator. Defaults to prefs. */
  groupSep?: string;
  /** Decimal separator. Defaults to prefs. */
  decimalSep?: string;
};

export type MoneyFormatOptions = SignOption &
  SepOptions & {
    /** Defaults to prefs.currencySymbol. */
    currencySymbol?: string;
    /** Defaults to prefs.currencyPosition. */
    currencyPosition?: "before" | "after";
    /** Fixed fraction digits. Defaults to prefs.numberDecimals. */
    fractionDigits?: number;
  };

export type PercentFormatOptions = SignOption &
  SepOptions & {
    /** Max fraction digits. Defaults to prefs.percentDecimals. */
    fractionDigits?: number;
  };

type RenderOptions = {
  style: "decimal" | "percent";
  groupSep: string;
  decimalSep: string;
  minFrac: number;
  maxFrac: number;
  signed: boolean;
};

// Format with Intl for structure, swap separators, and return the sign apart
// from the body so callers can place a currency symbol between them.
function renderParts(
  value: string | number,
  o: RenderOptions,
): { sign: string; body: string } {
  const parts = new Intl.NumberFormat("en-US", {
    style: o.style,
    useGrouping: "always",
    minimumFractionDigits: o.minFrac,
    maximumFractionDigits: o.maxFrac,
    signDisplay: o.signed ? "exceptZero" : "auto",
  }).formatToParts(value as unknown as number);

  let sign = "";
  let body = "";
  for (const p of parts) {
    if (p.type === "minusSign" || p.type === "plusSign") sign = p.value;
    else if (p.type === "group") body += o.groupSep;
    else if (p.type === "decimal") body += o.decimalSep;
    else body += p.value;
  }
  return { sign, body };
}

export function formatMoney(
  value: string | number,
  options: MoneyFormatOptions = {},
): string {
  const p = getPrefs();
  const frac = options.fractionDigits ?? p.numberDecimals;
  const { sign, body } = renderParts(value, {
    style: "decimal",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: frac,
    maxFrac: frac,
    signed: options.signed ?? false,
  });
  const symbol = options.currencySymbol ?? p.currencySymbol;
  const position = options.currencyPosition ?? p.currencyPosition;
  const withSymbol =
    position === "before" ? `${symbol}${body}` : `${body} ${symbol}`;
  return `${sign}${withSymbol}`;
}

export function formatQuantity(
  value: string | number,
  options: SepOptions & { fractionDigits?: number } = {},
): string {
  const p = getPrefs();
  const { sign, body } = renderParts(value, {
    style: "decimal",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: 0,
    maxFrac: options.fractionDigits ?? 2,
    signed: false,
  });
  return `${sign}${body}`;
}

export function formatPercent(
  value: string | number,
  options: PercentFormatOptions = {},
): string {
  const p = getPrefs();
  // Value is a ratio (0.1234 = 12.34%); Intl percent style multiplies by 100
  // and appends the % sign (captured in body via the percentSign part).
  const { sign, body } = renderParts(value, {
    style: "percent",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: 0,
    maxFrac: options.fractionDigits ?? p.percentDecimals,
    signed: options.signed ?? false,
  });
  return `${sign}${body}`;
}
