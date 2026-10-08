import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { Surface } from "../components/Surface";
import { CardState } from "../components/CardState";
import { AnnualisedReturnCard } from "../components/investments/AnnualisedReturnCard";
import { ReturnsCard } from "../components/investments/ReturnsCard";
import { ExposureDonut } from "../components/investments/ExposureDonut";
import { InvestmentsEmpty } from "../components/investments/InvestmentsEmpty";
import { holdingItems, regionItems, sectorItems } from "../components/investments/exposureColors";
import { exposure } from "../lib/exposure";
import { formatPercent } from "../lib/money";
import { mockInvestments, SCENARIOS, type InvestmentsData, type Scenario } from "./investments/mock";

export function Investments() {
  const { t } = useTranslation();
  // MOCKUP: flips between the states the page has to handle.
  const [scenario, setScenario] = useState<Scenario>(
    () => (new URLSearchParams(window.location.search).get("scenario") as Scenario | null) ?? "full",
  );
  const data = mockInvestments(scenario);

  return (
    <div>
      <PageHeader title={t("nav.investments")} />
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-amber-soft px-3 py-2 text-xs text-fg-dim">
        Mockup — invented figures
        <SegmentedControl
          options={SCENARIOS.map((s) => ({ value: s, label: s }))}
          value={scenario}
          onChange={(v) => setScenario(v as Scenario)}
        />
      </div>

      {scenario === "offline" ? (
        <Offline />
      ) : data === null ? (
        <InvestmentsEmpty />
      ) : (
        <InvestmentsBody data={data} />
      )}
    </div>
  );
}

function InvestmentsBody({ data }: { data: InvestmentsData }) {
  const { t, i18n } = useTranslation();
  const e = exposure(data.holdings);
  const excludedShare = e.excluded.reduce((s, x) => s + x.share, 0);

  return (
    <>
      <AnnualisedReturnCard data={data} className="my-4" />
      <ReturnsCard data={data} className="mb-4" />

      <section className="mt-8 mb-4">
        <h2 className="mb-3 px-1 text-lg font-semibold">{t("investments.exposure.title")}</h2>

        {e.excluded.length > 0 && (
          <p className="mb-3 flex items-start gap-1.5 px-1 text-xs text-fg-dim">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-fg-faint" />
            {t("investments.exposure.excluded", {
              count: e.excluded.length,
              names: e.excluded.map((x) => x.name).join(", "),
              share: formatPercent(excludedShare, { fractionDigits: 1 }),
            })}
          </p>
        )}

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
              title={t("investments.exposure.holdings")}
              items={holdingItems(e.holdings)}
              total={e.total}
            />
          </div>
        </div>
      </section>
    </>
  );
}

/** The API can't be reached: the page keeps its shape, each surface saying so
 *  the way every other card in the app does. */
function Offline() {
  const { t } = useTranslation();
  const card = (title: string, height: string, className = "") => (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <p className="text-fg font-semibold text-sm">{title}</p>
        {/* MOCKUP: Retry will refetch. */}
        <CardState variant="error" onRetry={() => {}} className={`mt-2 ${height}`} />
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
            {card(t("investments.exposure.holdings"), "h-52")}
          </div>
        </div>
      </section>
    </>
  );
}
