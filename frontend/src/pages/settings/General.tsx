import { useTranslation } from "react-i18next";

export function SettingsGeneral() {
  const { t } = useTranslation();
  return <h1 className="text-2xl font-bold">{t("settings.general")}</h1>;
}
