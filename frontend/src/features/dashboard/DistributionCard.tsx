import { useTranslation } from "react-i18next";

import { CardState } from "../../ui/CardState";
import { ExposureDonut } from "../exposure/ExposureDonut";
import { useAccounts } from "../../api/accounts";
import { useFxExcludedCount } from "../../api/holdings";
import { MIN_DRAWN_SHARE, distribution } from "../../lib/distribution";

type DistributionCardProps = {
  className?: string;
};

export function DistributionCard({ className = "" }: DistributionCardProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useAccounts();
  const excluded = useFxExcludedCount();
  const accounts = data ?? [];
  // The middle shows the net worth, overdrafts included; the ring shows how
  // what is owned is spread (`distribution`).
  const total = accounts.reduce((sum, a) => sum + Number(a.value), 0);
  const items = distribution(accounts).map(({ account: a, share }) => ({
    key: a.id,
    label: a.name,
    share,
    color: a.color,
    value: a.value,
    fxMissing: a.fxMissing,
  }));

  return (
    <ExposureDonut
      wide
      title={t("dashboard.distribution.title")}
      centerLabel={t("common.total")}
      items={items}
      total={total}
      fxExcluded={excluded > 0 || accounts.some((a) => a.fxMissing) ? excluded : undefined}
      minSlice={MIN_DRAWN_SHARE}
      placeholder={
        data === undefined ? (
          <CardState
            variant={isError ? "error" : "loading"}
            onRetry={() => refetch()}
            className="mt-2 h-55"
          />
        ) : undefined
      }
      className={className}
    />
  );
}
