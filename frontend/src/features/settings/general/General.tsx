import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { SegmentedControl } from "../../../ui/SegmentedControl";
import { Select } from "../../../ui/Select";
import { Toggle } from "../../../ui/Toggle";
import { useAuth } from "../../../auth/context";
import type { UserPrefs } from "../../../lib/prefs";
import { formatMoney } from "../../../lib/money";
import { formatDate } from "../../../lib/date";
import { CURRENCIES } from "../../../lib/currency";
import { timeZoneOptions } from "../../../lib/timeZoneList";
import { useCurrencyChange } from "../../../auth/useCurrencyChange";
import { CurrencyChangeHint } from "../../../auth/CurrencyChangeHint";

const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY/MM/DD", "YYYY-MM-DD"];

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

/** A date pattern as the reader writes it: JJ/MM/AAAA in French. */
function patternLabel(pattern: string, language: string): string {
  return language === "fr" ? pattern.replaceAll("D", "J").replaceAll("Y", "A") : pattern;
}

export function SettingsGeneral() {
  const { t, i18n } = useTranslation();
  const { prefs, updatePrefs } = useAuth();

  // Auto-save: every change persists that one setting and applies app-wide.
  const set = <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) =>
    void updatePrefs({ [key]: value });

  const currency = useCurrencyChange();

  return (
    <div className="flex flex-col gap-4 pb-8">
      <SettingsSurface className="md:mt-13" title={t("settings.general.localization")}>
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

          <Setting label={t("settings.general.timeZone")} hint={t("settings.general.timeZoneHint")}>
            <Select
              value={prefs.timeZone}
              onChange={(v) => set("timeZone", v)}
              options={timeZoneOptions(prefs.timeZone, i18n.language)}
              className="w-36 md:w-60"
            />
          </Setting>

          <Divider />

          <Setting
            label={t("settings.general.dateFormat")}
            hint={t("settings.general.today", {
              date: formatDate(new Date(), { prefs }),
            })}
          >
            <Select
              value={prefs.dateFormat}
              onChange={(v) => set("dateFormat", v)}
              options={DATE_FORMATS.map((f) => ({ value: f, label: patternLabel(f, i18n.language) }))}
              className="w-36 md:w-60"
            />
          </Setting>
        </div>
      </SettingsSurface>

      <SettingsSurface title={t("settings.general.numbersCurrency")}>
        <div className="flex flex-col gap-5">
          <Setting
            label={t("settings.general.currency")}
            hint={<CurrencyChangeHint pick={currency.pick} idle={t("settings.general.baseReportingCurrency")} />}
          >
            <Select
              value={currency.value}
              onChange={currency.change}
              options={CURRENCIES.map((c) => ({ value: c.code, label: c.label }))}
              className="w-36 md:w-60"
            />
          </Setting>

          <Divider />

          <div className="flex flex-col gap-4">
            <span className="text-sm font-medium text-fg">
              {t("settings.general.numberFormat")}
            </span>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-0 md:divide-x md:divide-surface-2">
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

            <div className="flex flex-col gap-1 rounded-xl bg-surface-2 px-3.5 py-2.25 md:flex-row md:items-center md:justify-between md:gap-0">
              <span className="text-xs text-fg-faint">{t("settings.general.preview")}</span>
              <span className="flex flex-wrap gap-x-5 font-mono text-sm">
                <span className="text-fg">
                  {formatMoney("1234567.89", { prefs })}
                </span>
                <span className="text-green">
                  {formatMoney("1234.5", { prefs, signed: true })}
                </span>
              </span>
            </div>
          </div>
        </div>
      </SettingsSurface>

      <SettingsSurface title={t("settings.general.privacy")}>
        <Setting
          label={t("settings.general.privateMode")}
          hint={t("settings.general.privateModeHint")}
        >
          <Toggle
            checked={prefs.privateMode}
            onChange={(v) => set("privateMode", v)}
            aria-label={t("settings.general.privateMode")}
          />
        </Setting>
      </SettingsSurface>
    </div>
  );
}

function Setting({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
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
    <div className={`flex flex-col gap-2 ${first ? "md:pr-4" : "md:px-4"}`}>
      <span className="text-xs text-fg-faint">{label}</span>
      {children}
    </div>
  );
}
