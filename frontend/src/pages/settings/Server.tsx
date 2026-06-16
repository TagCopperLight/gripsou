import { useTranslation } from "react-i18next";

export function SettingsServer() {
  const { t } = useTranslation();
  return <h1 className="text-2xl font-bold">{t("settings.server")}</h1>;
}
