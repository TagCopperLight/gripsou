import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Surface } from "../../components/Surface";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Select } from "../../components/Select";
import { useAuth } from "../../auth/context";
import type { UserPrefs } from "../../lib/prefs";
import { formatMoney } from "../../lib/money";
import { formatDate } from "../../lib/date";

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD", "YYYY-MM-DD"];

const CURRENCIES: { symbol: string; label: string }[] = [
  { symbol: "€", label: "EUR (€)" },
  { symbol: "$", label: "USD ($)" },
  { symbol: "£", label: "GBP (£)" },
  { symbol: "CHF", label: "CHF" },
  { symbol: "¥", label: "JPY (¥)" },
];

const GROUP_OPTIONS = [
  { value: " ", label: "1 000" },
  { value: ",", label: "1,000" },
  { value: ".", label: "1.000" },
  { value: "", label: "1000" },
];

const DECIMAL_OPTIONS = [
  { value: ".", label: "0.00" },
  { value: ",", label: "0,00" },
];

export function SettingsGeneral() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useAuth();

  // Auto-save: every change persists the whole prefs object and applies app-wide.
  const set = <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) =>
    void updatePrefs({ ...prefs, [key]: value });

  // Drive the preview from the reactive context prefs, not the module singleton
  // that formatMoney reads by default — the singleton isn't a React-tracked
  // dependency, so a default-args formatMoney("…") would render stale until a
  // remount. Passing explicit options makes the preview a pure function of the
  // context prefs, so it updates in lockstep with the controls above.
  const previewMoneyOpts = {
    groupSep: prefs.numberGroupSep,
    decimalSep: prefs.numberDecimalSep,
    currencySymbol: prefs.currencySymbol,
    currencyPosition: prefs.currencyPosition,
    fractionDigits: prefs.numberDecimals,
  };

  return (
    <div className="flex flex-col gap-4 pb-8">
      <Surface className="p-6 mt-13">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.general.localization")}
        </h2>
        <div className="flex flex-col gap-5">
          <Setting label={t("settings.general.language")} hint={t("settings.general.interfaceLanguage")}>
            <SegmentedControl
              value={prefs.uiLanguage}
              onChange={(lng) => set("uiLanguage", lng as UserPrefs["uiLanguage"])}
              options={[
                { value: "en", label: "English" },
                { value: "fr", label: "Français" },
              ]}
            />
          </Setting>

          <Divider />

          <Setting
            label={t("settings.general.dateFormat")}
            hint={t("settings.general.today", {
              date: formatDate(new Date(), { pattern: prefs.dateFormat }),
            })}
          >
            <Select
              value={prefs.dateFormat}
              onChange={(v) => set("dateFormat", v)}
              options={DATE_FORMATS.map((f) => ({ value: f, label: f }))}
              className="w-60"
            />
          </Setting>
        </div>
      </Surface>

      <Surface className="p-6">
        <h2 className="mb-5 text-lg font-semibold text-fg">
          {t("settings.general.numbersCurrency")}
        </h2>
        <div className="flex flex-col gap-5">
          <Setting
            label={t("settings.general.currency")}
            hint={t("settings.general.baseReportingCurrency")}
          >
            <Select
              value={prefs.currencySymbol}
              onChange={(v) => set("currencySymbol", v)}
              options={CURRENCIES.map((c) => ({ value: c.symbol, label: c.label }))}
              className="w-60"
            />
          </Setting>

          <Divider />

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-fg">
                {t("settings.general.numberFormat")}
              </span>
              <span className="text-xs text-fg-faint">
                {t("settings.general.numberFormatHint")}
              </span>
            </div>

            <div className="grid grid-cols-3 divide-x divide-surface-2">
              <FieldCol label={t("settings.general.thousandsSeparator")} first>
                <Select
                  value={prefs.numberGroupSep}
                  onChange={(v) => set("numberGroupSep", v)}
                  options={GROUP_OPTIONS}
                />
              </FieldCol>
              <FieldCol label={t("settings.general.decimalSeparator")}>
                <Select
                  value={prefs.numberDecimalSep}
                  onChange={(v) => set("numberDecimalSep", v)}
                  options={DECIMAL_OPTIONS}
                />
              </FieldCol>
              <FieldCol label={t("settings.general.symbolPosition")}>
                <Select
                  value={prefs.currencyPosition}
                  onChange={(v) =>
                    set("currencyPosition", v as UserPrefs["currencyPosition"])
                  }
                  options={[
                    { value: "before", label: t("settings.general.symbolBefore") },
                    { value: "after", label: t("settings.general.symbolAfter") },
                  ]}
                />
              </FieldCol>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3">
              <span className="text-xs text-fg-faint">{t("settings.general.preview")}</span>
              <span className="flex gap-5 font-mono text-[15px]">
                <span className="text-fg">
                  {formatMoney("1234567.89", previewMoneyOpts)}
                </span>
                <span className="text-green">
                  {formatMoney("1234.5", { ...previewMoneyOpts, signed: true })}
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
