import { useTranslation } from "react-i18next";

export function SettingsUsers() {
  const { t } = useTranslation();
  return <h1 className="text-2xl font-bold">{t("settings.users")}</h1>;
}
