import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { Toggle } from "../Toggle";
import { useAuth } from "../../auth/context";

/** Settings → Budget: the one per-user display preference the transactions table reads.
 *  Shaped like the General page's privacy setting, auto-saving on change. */
export function ListPrefsSurface() {
  const { t } = useTranslation();
  const { prefs, updatePrefs } = useAuth();

  return (
    <Surface className="p-6">
      <h2 className="mb-5 text-lg font-semibold text-fg">
        {t("settings.budget.listPrefs.title")}
      </h2>
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
          onChange={(v) => void updatePrefs({ ...prefs, showChecked: v })}
          aria-label={t("settings.budget.listPrefs.showChecked")}
        />
      </div>
    </Surface>
  );
}
