import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { AnnualisedReturnCard } from "../components/investments/AnnualisedReturnCard";
import { ReturnsCard } from "../components/investments/ReturnsCard";
import { ExposureDonut } from "../components/investments/ExposureDonut";
import { InvestmentsEmpty } from "../components/investments/InvestmentsEmpty";
import { holdingItems, regionItems, sectorItems } from "../components/investments/exposureColors";
import { exposure } from "../lib/exposure";
import { formatPercent } from "../lib/money";
import { mockInvestments, SCENARIOS, type Scenario } from "./investments/mock";

export function Investments() {
  const { t, i18n } = useTranslation();
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

      {data === null ? (
        <InvestmentsEmpty variant={scenario === "noConnection" ? "noConnection" : "empty"} />
      ) : (
        <InvestmentsBody data={data} t={t} lang={i18n.language} />
      )}
    </div>
  );
}

function InvestmentsBody({
  data,
  t,
  lang,
}: {
  data: NonNullable<ReturnType<typeof mockInvestments>>;
  t: ReturnType<typeof useTranslation>["t"];
  lang: string;
}) {
  const e = exposure(data.holdings);
  const excludedShare = e.excluded.reduce((s, x) => s + x.share, 0);

  return (
    <>
      <AnnualisedReturnCard data={data} className="my-4" />
      <ReturnsCard data={data} className="mb-4" />

      <section className="mt-8 mb-4">
        <div className="mb-3 flex flex-col gap-1 px-1 md:flex-row md:items-baseline md:justify-between md:gap-4">
          <h2 className="text-lg font-semibold">{t("investments.exposure.title")}</h2>
          <p className="text-fg-faint text-xs">{t("investments.exposure.legend")}</p>
        </div>

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
            items={regionItems(e.regions, t, lang)}
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
