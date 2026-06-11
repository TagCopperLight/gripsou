import { useTranslation } from "react-i18next";

export function Transactions() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("nav.transactions")}</h1>
    </div>
  );
}
