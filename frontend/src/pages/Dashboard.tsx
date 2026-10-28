import { useTranslation } from "react-i18next";
import { PageHeader } from "../components/PageHeader";
import { NetWorthCard } from "../components/NetWorthCard";
import { DistributionCard } from "../components/DistributionCard";
import { HoldingsCard } from "../components/HoldingsCard";
import { useAccounts } from "../api/hooks";

export function Dashboard() {
  const { t } = useTranslation();
  // With no accounts the net worth card says why and what to do; the two
  // cards below would only be an empty ring and a bare table header.
  const noAccounts = useAccounts().data?.length === 0;
  return (
    <div>
      <PageHeader title={t("nav.dashboard")} />
      <NetWorthCard className="my-4" />
      {!noAccounts && (
        <>
          <DistributionCard className="mb-4" />
          <HoldingsCard className="mb-4" />
        </>
      )}
    </div>
  );
}
