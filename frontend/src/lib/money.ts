// Intl.NumberFormat (en-US) gives digit grouping and rounding structure, then the
// user's separators and symbol from prefs are swapped in: free-form combinations
// a single locale can't express.

import type { UserPrefs } from "../api/wire";
import { getPrefs } from "./prefs";
import { currencySymbol } from "./currency";

type SignOption = {
  /** Prefix with + (positive) / - (negative). Zero stays unsigned. */
  signed?: boolean;
};

type PrefsOption = {
  /** The prefs to format with. Defaults to the signed-in user's. */
  prefs?: UserPrefs;
};

type SepOptions = PrefsOption & {
  /** Thousands group separator. Defaults to prefs. */
  groupSep?: string;
  /** Decimal separator. Defaults to prefs. */
  decimalSep?: string;
};

export type MoneyFormatOptions = SignOption &
  SepOptions & {
    /** ISO code to format in, when it isn't the user's reporting currency
     * (e.g. a native unit price). Defaults to prefs.currency. */
    currency?: string;
    /** Raw symbol override, bypassing the code→symbol map. */
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

// Intl formatters are expensive across a ledger. Only number structure is in the key: separators and currency come from prefs on every call.
const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(o: RenderOptions): Intl.NumberFormat {
  const key = `${o.style}:${o.minFrac}:${o.maxFrac}:${o.signed}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: o.style,
      useGrouping: "always",
      minimumFractionDigits: o.minFrac,
      maximumFractionDigits: o.maxFrac,
      signDisplay: o.signed ? "exceptZero" : "auto",
    });
    if (numberFormats.size >= 32) {
      numberFormats.delete(numberFormats.keys().next().value!);
    }
    numberFormats.set(key, formatter);
  }
  return formatter;
}

// The sign is returned apart so callers can place a currency symbol between sign and body.
function renderParts(
  value: string | number,
  o: RenderOptions,
): { sign: string; body: string } {
  const parts = numberFormat(o).formatToParts(value as unknown as number);

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

export function formatMaskedMoney(
  value: string | number,
  masked: boolean,
  options?: MoneyFormatOptions,
): string {
  const text = formatMoney(value, options);
  return masked ? "*".repeat(text.length) : text;
}

export function formatMoney(
  value: string | number,
  options: MoneyFormatOptions = {},
): string {
  const p = options.prefs ?? getPrefs();
  const frac = options.fractionDigits ?? p.numberDecimals;
  const { sign, body } = renderParts(value, {
    style: "decimal",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: frac,
    maxFrac: frac,
    signed: options.signed ?? false,
  });
  const symbol =
    options.currencySymbol ?? currencySymbol(options.currency ?? p.currency);
  const position = options.currencyPosition ?? p.currencyPosition;
  const withSymbol =
    position === "before" ? `${symbol}${body}` : `${body} ${symbol}`;
  return `${sign}${withSymbol}`;
}

export function formatQuantity(
  value: string | number,
  options: SepOptions & { fractionDigits?: number } = {},
): string {
  const p = options.prefs ?? getPrefs();
  const { sign, body } = renderParts(value, {
    style: "decimal",
    groupSep: options.groupSep ?? p.numberGroupSep,
    decimalSep: options.decimalSep ?? p.numberDecimalSep,
    minFrac: 0,
    // 8 covers fractional shares and satoshis, and hides float noise of a locally summed quantity.
    maxFrac: options.fractionDigits ?? 8,
    signed: false,
  });
  return `${sign}${body}`;
}

export function formatPercent(
  value: string | number,
  options: PercentFormatOptions = {},
): string {
  const p = options.prefs ?? getPrefs();
  // Intl percent multiplies by 100 and appends the sign.
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
