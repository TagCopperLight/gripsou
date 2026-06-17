import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Select } from "../../components/Select";

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD", "YYYY-MM-DD"];

const CURRENCIES: { code: string; symbol: string }[] = [
  { code: "EUR", symbol: "€" },
  { code: "USD", symbol: "$" },
  { code: "GBP", symbol: "£" },
  { code: "CHF", symbol: "CHF" },
  { code: "JPY", symbol: "¥" },
];

const THOUSANDS_OPTIONS = [
  { value: " ", label: "1 000" },
  { value: ",", label: "1,000" },
  { value: ".", label: "1.000" },
  { value: "", label: "1000" },
];

const DECIMAL_OPTIONS = [
  { value: ".", label: "0.00" },
  { value: ",", label: "0,00" },
];

type SymbolPosition = "before" | "after";

export function SettingsGeneral() {
  const { t, i18n } = useTranslation();

  // Local-only for now: persistence and real currency conversion land later.
  const [dateFormat, setDateFormat] = useState(DATE_FORMATS[0]);
  const [currency, setCurrency] = useState(CURRENCIES[0].code);
  const [thousands, setThousands] = useState(" ");
  const [decimal, setDecimal] = useState(",");
  const [symbolPosition, setSymbolPosition] = useState<SymbolPosition>("after");

  const symbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? currency;
  const numberOpts = { thousands, decimal, symbol, symbolPosition };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Surface className="p-6 mt-13">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.localization")}
        </h2>
        <div className="flex flex-col gap-5">
          <Setting label={t("settings.language")} hint={t("settings.interfaceLanguage")}>
            <SegmentedControl
              value={i18n.language}
              onChange={(lng) => void i18n.changeLanguage(lng)}
              options={[
                { value: "en", label: "English" },
                { value: "fr", label: "Français" },
              ]}
            />
          </Setting>

          <Divider />

          <Setting
            label={t("settings.dateFormat")}
            hint={t("settings.today", { date: formatDate(new Date(), dateFormat) })}
          >
            <Select
              value={dateFormat}
              onChange={setDateFormat}
              options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
              className="w-60"
            />
          </Setting>
        </div>
      </Surface>

      <Surface className="p-6">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.numbersCurrency")}
        </h2>
        <div className="flex flex-col gap-5">
          <Setting
            label={t("settings.currency")}
            hint={t("settings.baseReportingCurrency")}
          >
            <Select
              value={currency}
              onChange={setCurrency}
              options={CURRENCIES.map((c) => ({
                value: c.code,
                label: `${c.code} (${c.symbol})`,
              }))}
              className="w-60"
            />
          </Setting>

          <Divider />

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-fg">
                {t("settings.numberFormat")}
              </span>
              <span className="text-xs text-fg-faint">
                {t("settings.numberFormatHint")}
              </span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-surface-2">
              <FieldCol label={t("settings.thousandsSeparator")} first>
                <Select value={thousands} onChange={setThousands} options={THOUSANDS_OPTIONS} />
              </FieldCol>
              <FieldCol label={t("settings.decimalSeparator")}>
                <Select value={decimal} onChange={setDecimal} options={DECIMAL_OPTIONS} />
              </FieldCol>
              <FieldCol label={t("settings.symbolPosition")}>
                <Select
                  value={symbolPosition}
                  onChange={(v) => setSymbolPosition(v as SymbolPosition)}
                  options={[
                    { value: "before", label: t("settings.symbolBefore") },
                    { value: "after", label: t("settings.symbolAfter") },
                  ]}
                />
              </FieldCol>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
              <span className="text-xs text-fg-faint">{t("settings.preview")}</span>
              <span className="flex gap-5 font-mono text-[15px]">
                <span className="text-fg">{formatNumber(1234567.89, numberOpts)}</span>
                <span className="text-green">
                  {formatNumber(1234.5, { ...numberOpts, signed: true })}
                </span>
              </span>
            </div>
          </div>
        </div>
      </Surface>
    </div>
  );
}

function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg">{label}</span>
        {hint && <span className="text-xs text-fg-faint">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-surface-2" />;
}

function FieldCol({
  label,
  first = false,
  children,
}: {
  label: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-2 ${first ? "pr-4" : "px-4"}`}>
      <span className="text-xs text-fg-faint">{label}</span>
      {children}
    </div>
  );
}

function formatDate(date: Date, pattern: string): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return pattern.replace("DD", dd).replace("MM", mm).replace("YYYY", yyyy);
}

function formatNumber(
  value: number,
  opts: {
    thousands: string;
    decimal: string;
    symbol: string;
    symbolPosition: SymbolPosition;
    signed?: boolean;
  },
): string {
  const { thousands, decimal, symbol, symbolPosition, signed } = opts;
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  const [intPart, fracPart] = Math.abs(value).toFixed(2).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  const body = `${grouped}${decimal}${fracPart}`;
  const withSymbol =
    symbolPosition === "before" ? `${symbol}${body}` : `${body} ${symbol}`;
  return `${sign}${withSymbol}`;
}
