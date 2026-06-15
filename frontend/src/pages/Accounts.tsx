import { useTranslation } from "react-i18next";
import { AccountsChartCard } from "../components/AccountsChartCard";
import { AccountsList } from "../components/AccountsList";

export function Accounts() {
  const { t } = useTranslation();
  return (
    <div>
      <h1 className="text-2xl font-bold">{t("nav.accounts")}</h1>
      <AccountsChartCard className="my-4" />
      <AccountsList className="mb-4" />
    </div>
  );
}
