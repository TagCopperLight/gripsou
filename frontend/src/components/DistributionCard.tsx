import { useTranslation } from "react-i18next";

import { CardState } from "./CardState";
import { ExposureDonut } from "./investments/ExposureDonut";
import { accountTypeLabel } from "../api/types";
import { useAccounts, useHoldings } from "../api/hooks";
import { ExcludedNote } from "./FxNote";
import { unconverted } from "../lib/fxNote";

type DistributionCardProps = {
  className?: string;
};

export function DistributionCard({ className = "" }: DistributionCardProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useAccounts();
  const holdings = useHoldings();
  const accounts = data ?? [];
  const excluded = unconverted(holdings.data ?? []);
  const total = accounts.reduce((sum, a) => sum + Number(a.value), 0);
  // Largest proportion first, in both the donut and the legend.
  const items = [...accounts]
    .sort((a, b) => Number(b.value) - Number(a.value))
    .map((a) => ({
      key: a.id,
      label: a.name,
      share: Number(a.value) / total,
      color: a.color,
      value: a.value,
      tag: accountTypeLabel(t, a.typeKey),
      fxMissing: a.fxMissing,
    }));
  const fxFootnote = excluded.length > 0 || accounts.some((a) => a.fxMissing)
    ? <ExcludedNote items={excluded} />
    : undefined;

  return (
    <ExposureDonut
      wide
      title={t("dashboard.distribution.title")}
      centerLabel={t("common.total")}
      items={items}
      total={total}
      fxFootnote={fxFootnote}
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
