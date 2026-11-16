import { useTranslation } from "react-i18next";

import { SettingsSurface } from "../../../ui/SettingsSurface";
import { Toggle } from "../../../ui/Toggle";
import { useAuth } from "../../../auth/context";

export function ListPrefsSurface() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useAuth();

  return (
    <SettingsSurface title={t("settings.budget.listPrefs.title")}>
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="text-sm font-medium text-fg">
            {t("settings.budget.listPrefs.showChecked")}
          </p>
          <p className="text-xs text-fg-faint">
            {t("settings.budget.listPrefs.showCheckedHint")}
          </p>
        </div>
        <Toggle
          checked={prefs.showChecked}
          onChange={(v) => void updatePrefs({ showChecked: v })}
          aria-label={t("settings.budget.listPrefs.showChecked")}
        />
      </div>
    </SettingsSurface>
  );
}
