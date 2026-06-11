import { useTranslation } from "react-i18next";

export function Accounts() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("nav.accounts")}</h1>
    </div>
  );
}
