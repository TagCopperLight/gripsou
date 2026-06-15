import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { AccountsChartCard } from "../components/AccountsChartCard";
import { AccountsList } from "../components/AccountsList";

export function Accounts() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t("nav.accounts")} />
      <AccountsChartCard className="my-4" />
      <AccountsList className="mb-4" />
    </div>
  );
}
