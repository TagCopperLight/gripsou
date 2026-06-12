// Money arrives from the API as decimal strings (never floats — see CLAUDE.md).
// Intl.NumberFormat accepts string values and formats them without precision loss,
// so we pass the raw string straight through.

type SignOption = {
  /** Prefix with + (positive) / - (negative), directly against the number. Zero stays unsigned. */
  signed?: boolean;
};

export type MoneyFormatOptions = SignOption & {
  /** BCP-47 locale, e.g. "fr-FR". Sourced from per-user prefs once settings land. */
  locale?: string;
  /** ISO 4217 currency code, e.g. "EUR". */
  currency?: string;
  /** Force exactly this many decimal places (0 → no decimals). Defaults to the currency's own (2 for EUR). */
  fractionDigits?: number;
};

export type PercentFormatOptions = SignOption & {
  /** BCP-47 locale, e.g. "fr-FR". */
  locale?: string;
  /** Decimal places to show (default 2). */
  fractionDigits?: number;
};

const MONEY_DEFAULTS: Required<Pick<MoneyFormatOptions, "locale" | "currency">> = {
  locale: "fr-FR",
  currency: "EUR",
};

const PERCENT_DEFAULTS: Required<Omit<PercentFormatOptions, "signed">> = {
  locale: "fr-FR",
  fractionDigits: 1,
};

function formatWithSpaceGroups(
  formatter: Intl.NumberFormat,
  value: string | number,
): string {
  return formatter
    .formatToParts(value as unknown as number)
    .map((part) => (part.type === "group" ? " " : part.value))
    .join("");
}

export function formatMoney(
  value: string | number,
  options: MoneyFormatOptions = {},
): string {
  const { locale, currency, signed, fractionDigits } = {
    ...MONEY_DEFAULTS,
    ...options,
  };
  return formatWithSpaceGroups(
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      useGrouping: "always",
      signDisplay: signed ? "exceptZero" : "auto",
      ...(fractionDigits !== undefined && {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }),
    }),
    value,
  );
}

export function formatQuantity(
  value: string | number,
  options: { locale?: string; fractionDigits?: number } = {},
): string {
  const { locale = "fr-FR", fractionDigits = 2 } = options;
  return formatWithSpaceGroups(
    new Intl.NumberFormat(locale, {
      useGrouping: "always",
      maximumFractionDigits: fractionDigits,
    }),
    value,
  );
}

export function formatPercent(
  value: string | number,
  options: PercentFormatOptions = {},
): string {
  const { locale, fractionDigits, signed } = { ...PERCENT_DEFAULTS, ...options };
  return formatWithSpaceGroups(
    new Intl.NumberFormat(locale, {
      style: "percent",
      useGrouping: "always",
      maximumFractionDigits: fractionDigits,
      signDisplay: signed ? "exceptZero" : "auto",
    }),
    value,
  );
}
