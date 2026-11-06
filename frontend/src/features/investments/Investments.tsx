import { useTranslation } from "react-i18next";

import { PageHeader } from "../../ui/PageHeader";
import { Surface } from "../../ui/Surface";
import { CardState } from "../../ui/CardState";
import { AnnualisedReturnCard } from "./AnnualisedReturnCard";
import { ReturnsCard } from "./ReturnsCard";
import { ExposureDonut } from "../exposure/ExposureDonut";
import { InvestmentsEmpty } from "./InvestmentsEmpty";
import { indexItems, regionItems, sectorItems } from "../exposure/exposureColors";
import { useHoldings, useInvestmentReturns } from "../../api/holdings";
import type { InvestmentReturns } from "../../api/types";
import { exposure, type ExposureHolding } from "../../lib/exposure";
import { investmentsView } from "../../lib/investments";
import { CardTitle } from "../../ui/CardTitle";
import { usePrivacy } from "../../auth/usePrivacy";

export function Investments() {
  const { t } = useTranslation();
  const returns = useInvestmentReturns();
  const holdings = useHoldings();

  const failed = returns.isError || holdings.isError;
  const view =
    returns.data !== undefined && holdings.data !== undefined ? investmentsView(holdings.data, returns.data) : null;

  return (
    <div>
      <PageHeader title={t("nav.investments")} />
      {view === null || returns.data === undefined ? (
        <Placeholder
          variant={failed ? "error" : "loading"}
          onRetry={() => {
            void returns.refetch();
            void holdings.refetch();
          }}
        />
      ) : view.empty ? (
        <InvestmentsEmpty />
      ) : (
        <InvestmentsBody data={returns.data} held={view.held} excluded={view.excluded} />
      )}
    </div>
  );
}

function InvestmentsBody({ data, held, excluded }: { data: InvestmentReturns; held: ExposureHolding[]; excluded: number }) {
  const { t, i18n } = useTranslation();
  // One eye by the section's heading reveals the three donuts.
  const privacy = usePrivacy();
  const e = exposure(held);
  // Securities with no rate are worth zero here, so every donut leaves them out.
  const fxExcluded = excluded > 0 ? excluded : undefined;

  return (
    <>
      <AnnualisedReturnCard data={data} className="my-4" />
      <ReturnsCard data={data} className="mb-4" />

      <section className="mt-8 mb-4">
        <CardTitle size="lg" className="mb-3 px-1" privacy={privacy}>
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
          />
          <div className="grid gap-4 md:grid-cols-2">
            <ExposureDonut
              title={t("investments.exposure.sectors")}
              items={sectorItems(e.sectors, t)}
              total={e.covered}
              fxExcluded={fxExcluded}
              masked={privacy.masked}
            />
            <ExposureDonut
              title={t("investments.exposure.indices")}
              items={indexItems(e.indices, t)}
              total={e.total}
              fxExcluded={fxExcluded}
              masked={privacy.masked}
            />
          </div>
        </div>
      </section>
    </>
  );
}

/** Loading, or the API can't be reached: the page keeps its shape, each
 *  surface saying so the way every other card in the app does. */
function Placeholder({ variant, onRetry }: { variant: "loading" | "error"; onRetry: () => void }) {
  const { t } = useTranslation();
  const card = (title: string, height: string, className = "") => (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <CardTitle>{title}</CardTitle>
        <CardState variant={variant} onRetry={onRetry} className={`mt-2 ${height}`} />
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
