import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { NetWorthCard } from "../components/NetWorthCard";
import { DistributionCard } from "../components/DistributionCard";
import { HoldingsCard } from "../components/HoldingsCard";

export function Dashboard() {
  const { t } = useTranslation();
  return (
    <div>
      <PageHeader title={t("nav.dashboard")} />
      <NetWorthCard className="my-4" />
      <DistributionCard className="mb-4" />
      <HoldingsCard className="mb-4" />
    </div>
  );
}
