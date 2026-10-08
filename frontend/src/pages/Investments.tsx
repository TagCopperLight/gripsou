import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { Surface } from "../components/Surface";
import { CardState } from "../components/CardState";
import { AnnualisedReturnCard } from "../components/investments/AnnualisedReturnCard";
import { ReturnsCard } from "../components/investments/ReturnsCard";
import { ExposureDonut } from "../components/investments/ExposureDonut";
import { InvestmentsEmpty } from "../components/investments/InvestmentsEmpty";
import { indexItems, regionItems, sectorItems } from "../components/investments/exposureColors";
import { useHoldings, useInvestmentReturns } from "../api/hooks";
import type { Holding, InvestmentReturns } from "../api/types";
import { exposure, type ExposureHolding } from "../lib/exposure";

/** The securities the page is about: cash never counts here. */
function securities(holdings: Holding[]): ExposureHolding[] {
  return holdings
    .filter((h) => h.kind !== "cash")
    .map((h) => ({
      name: h.name,
      kind: h.kind,
      value: Number(h.value),
      composition: h.composition,
    }));
}

export function Investments() {
  const { t } = useTranslation();
  const returns = useInvestmentReturns();
  const holdings = useHoldings();

  const failed = returns.isError || holdings.isError;
  const ready = returns.data !== undefined && holdings.data !== undefined;
  const held = ready ? securities(holdings.data) : [];

  return (
    <div>
      <PageHeader title={t("nav.investments")} />
      {!ready ? (
        <Placeholder
          variant={failed ? "error" : "loading"}
          onRetry={() => {
            void returns.refetch();
            void holdings.refetch();
          }}
        />
      ) : held.length === 0 && returns.data.accounts.length === 0 ? (
        <InvestmentsEmpty />
      ) : (
        <InvestmentsBody data={returns.data} held={held} />
      )}
    </div>
  );
}

function InvestmentsBody({ data, held }: { data: InvestmentReturns; held: ExposureHolding[] }) {
  const { t, i18n } = useTranslation();
  const e = exposure(held);

  return (
    <>
      <AnnualisedReturnCard data={data} className="my-4" />
      <ReturnsCard data={data} className="mb-4" />

      <section className="mt-8 mb-4">
        <h2 className="mb-3 px-1 text-lg font-semibold">{t("investments.exposure.title")}</h2>

        <div className="flex flex-col gap-4">
          <ExposureDonut
            wide
            title={t("investments.exposure.regions")}
            items={regionItems(e.regions, t, i18n.language)}
            total={e.covered}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <ExposureDonut
              title={t("investments.exposure.sectors")}
              items={sectorItems(e.sectors, t)}
              total={e.covered}
            />
            <ExposureDonut
              title={t("investments.exposure.indices")}
              items={indexItems(e.indices, t)}
              total={e.total}
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
        <p className="text-fg font-semibold text-sm">{title}</p>
        <CardState variant={variant} onRetry={onRetry} className={`mt-2 ${height}`} />
      </div>
    </Surface>
  );
  return (
    <>
      {card(t("investments.annualised.title"), "h-28", "my-4")}
      {card(t("investments.returns.title"), "h-40", "mb-4")}
      <section className="mt-8 mb-4">
        <h2 className="mb-3 px-1 text-lg font-semibold">{t("investments.exposure.title")}</h2>
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
