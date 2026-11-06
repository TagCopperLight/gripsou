// Money/quantities arrive from the API as decimal strings (never floats — see
// CLAUDE.md). We use Intl.NumberFormat (en-US, predictable part types) only for
// digit grouping + rounding structure, then substitute the user's independent
// separators / currency symbol from prefs. This supports free-form combinations
// (e.g. US dates + French separators + symbol-after) that a single locale can't.

import { getPrefs, type UserPrefs } from "./prefs";
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

// Constructing Intl formatters is expensive across a ledger's cells. Only
// number structure belongs in the key: separators and currency still come
// from the current prefs on every call. Bound the cache for option overrides.
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

// Format with Intl for structure, swap separators, and return the sign apart
// from the body so callers can place a currency symbol between them.
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

/** A formatted amount, or in private mode one asterisk per character of it:
 *  a mask exactly as wide as the figure it hides. */
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
    // 8 covers fractional shares and satoshis in full, and still hides the
    // float noise of a quantity summed locally (0.1 + 0.2).
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
