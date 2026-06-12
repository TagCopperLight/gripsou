import { useTranslation } from "react-i18next";
import { NetWorthCard } from "../components/NetWorthCard";
import { DistributionCard } from "../components/DistributionCard";
import { HoldingsCard } from "../components/HoldingsCard";

export function Dashboard() {
  const { t } = useTranslation();
  return (
    <div>
      <p className="text-fg-dim text-sm pb-1">
        {new Date().toLocaleDateString("default", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}
      </p>
      <h1 className="text-2xl font-bold">{t("nav.dashboard")}</h1>
      <NetWorthCard className="my-4" />
      <DistributionCard className="mb-4" />
      <HoldingsCard className="mb-4" />
    </div>
  );
}
