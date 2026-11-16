import { useTranslation } from "react-i18next";

import { PageHeader } from "../../ui/PageHeader";
import { Surface } from "../../ui/Surface";
import { CardError } from "../../ui/CardError";
import { AnnualisedReturnCard } from "./AnnualisedReturnCard";
import { ReturnsCard } from "./ReturnsCard";
import { ExposureDonut } from "../exposure/ExposureDonut";
import { InvestmentsEmpty } from "./InvestmentsEmpty";
import { indexItems, regionItems, sectorItems } from "../exposure/exposureColors";
import { useHoldings, useInvestmentReturns } from "../../api/holdings";
import type { InvestmentReturns } from "../../api/wire";
import { exposure, type ExposureHolding } from "../../lib/exposure";
import { investmentsView } from "../../lib/investments";
import { CardTitle } from "../../ui/CardTitle";
import { usePrivacy } from "../../auth/usePrivacy";

export function Investments() {
  const { t } = useTranslation();
  const returns = useInvestmentReturns();
  const holdings = useHoldings();

  const loading = returns.isPending || holdings.isPending;
  const view =
    returns.data !== undefined && holdings.data !== undefined ? investmentsView(holdings.data, returns.data) : null;

  return (
    <div>
      <PageHeader title={t("nav.investments")} />
      {view !== null && returns.data !== undefined ? (
        view.empty ? <InvestmentsEmpty /> : <InvestmentsBody data={returns.data} held={view.held} excluded={view.excluded} />
      ) : loading ? (
        <InvestmentsBody />
      ) : (
        <Placeholder
          onRetry={() => {
            void returns.refetch();
            void holdings.refetch();
          }}
        />
      )}
    </div>
  );
}

function InvestmentsBody({ data, held = [], excluded = 0 }: { data?: InvestmentReturns; held?: ExposureHolding[]; excluded?: number }) {
  const { t, i18n } = useTranslation();
  const privacy = usePrivacy();
  const e = exposure(held);
  // Securities with no rate are worth zero here, so every donut leaves them out.
  const fxExcluded = excluded > 0 ? excluded : undefined;

  return (
    <>
      <AnnualisedReturnCard data={data} className="my-4" />
      <ReturnsCard data={data} className="mb-4" />

      <section className="mt-8 mb-4">
        <CardTitle size="lg" className="mb-3 px-1" privacy={data !== undefined && privacy}>
          {t("investments.exposure.title")}
        </CardTitle>

        <div className="flex flex-col gap-4">
          <ExposureDonut
            wide
            title={t("investments.exposure.regions")}
            items={regionItems(e.regions, t, i18n.language)}
            total={e.covered}
            fxExcluded={fxExcluded}
            masked={privacy.masked}
            loading={data === undefined}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <ExposureDonut
              title={t("investments.exposure.sectors")}
              items={sectorItems(e.sectors, t)}
              total={e.covered}
              fxExcluded={fxExcluded}
              masked={privacy.masked}
              loading={data === undefined}
            />
            <ExposureDonut
              title={t("investments.exposure.indices")}
              items={indexItems(e.indices, t)}
              total={e.total}
              fxExcluded={fxExcluded}
              masked={privacy.masked}
              loading={data === undefined}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function Placeholder({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const card = (title: string, height: string, className = "") => (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <CardTitle>{title}</CardTitle>
        <CardError onRetry={onRetry} className={`mt-2 ${height}`} />
      </div>
    </Surface>
  );
  return (
    <>
      {card(t("investments.annualised.title"), "h-28", "my-4")}
      {card(t("investments.returns.title"), "h-40", "mb-4")}
      <section className="mt-8 mb-4">
        <CardTitle size="lg" className="mb-3 px-1">{t("investments.exposure.title")}</CardTitle>
        <div className="flex flex-col gap-4">
          {card(t("investments.exposure.regions"), "h-64")}
          <div className="grid gap-4 md:grid-cols-2">
            {card(t("investments.exposure.sectors"), "h-52")}
            {card(t("investments.exposure.indices"), "h-52")}
          </div>
        </div>
      </section>
    </>
  );
}
