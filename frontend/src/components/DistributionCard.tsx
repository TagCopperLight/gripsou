import { useTranslation } from "react-i18next";

import { CardState } from "./CardState";
import { ExposureDonut } from "./investments/ExposureDonut";
import { useAccounts, useHoldings } from "../api/hooks";
import { ExcludedNote } from "./FxNote";
import { distribution } from "../lib/distribution";
import { usePrivacy } from "../auth/usePrivacy";

type DistributionCardProps = {
  className?: string;
};

export function DistributionCard({ className = "" }: DistributionCardProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useAccounts();
  const holdings = useHoldings();
  const privacy = usePrivacy();
  const accounts = data ?? [];
  const excluded = (holdings.data ?? []).filter((h) => h.fxMissing).length;
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
  const fxFootnote = excluded > 0 || accounts.some((a) => a.fxMissing)
    ? <ExcludedNote count={excluded} />
    : undefined;

  return (
    <ExposureDonut
      wide
      title={t("dashboard.distribution.title")}
      centerLabel={t("common.total")}
      items={items}
      total={total}
      fxFootnote={fxFootnote}
      privacy={privacy}
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
