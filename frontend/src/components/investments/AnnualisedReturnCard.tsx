import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { MaskedMoney, PrivacyEye } from "../PrivateMoney";
import { Percent } from "../Percent";
import { ReturnSpan } from "./ReturnSpan";
import { leavesOut, mutedToneClass, toneClass } from "../../lib/returns";
import { FxAsterisk } from "../FxNote";
import { ExcludedNotes } from "./ExcludedNotes";
import type { InvestmentReturns } from "../../api/types";
import { usePrivacy } from "../../auth/usePrivacy";

type AnnualisedReturnCardProps = {
  data: InvestmentReturns;
  className?: string;
};

/** The page's headline: the money-weighted return of everything invested,
 *  per year, with the plain figures it sits on to its right. */
export function AnnualisedReturnCard({ data, className = "" }: AnnualisedReturnCardProps) {
  const { t } = useTranslation();
  const { total, today } = data;
  const privacy = usePrivacy();
  const partial = leavesOut(total);
  // Every holding left out: the figures cover nothing, rather than read 0.
  const empty = partial && Number(total.invested) === 0 && Number(total.value) === 0;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-baseline-last md:justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-fg font-semibold text-sm">
              {t("investments.annualised.title")}
              {privacy.enabled && (
                <span className="ml-3 inline-flex align-middle">
                  <PrivacyEye size="sm" masked={privacy.masked} toggle={privacy.toggle} />
                </span>
              )}
            </p>
            {total.annualised === null ? (
              <span className="relative w-fit text-[32px] font-semibold tracking-tight text-fg-faint md:text-[40px]">
                —
                {partial && <FxAsterisk size="lg" />}
              </span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="relative flex items-baseline whitespace-nowrap">
                  <Percent
                    value={total.annualised}
                    signed
                    fractionDigits={1}
                    className={`text-[32px] font-semibold tracking-tight md:text-[40px] ${toneClass(total.annualised)}`}
                  />
                  {/* /yr at 65% of the figure's size. */}
                  <span className={`ml-1 font-mono text-[21px] md:text-[26px] ${mutedToneClass(total.annualised)}`}>
                    {t("investments.returns.perYearShort")}
                  </span>
                  {partial && <FxAsterisk size="lg" />}
                </span>
                {total.since && <ReturnSpan since={total.since} today={today} className="text-sm" />}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-4 md:flex md:gap-10">
            <div className="flex flex-col gap-1 md:items-end">
              <dt className="text-fg-faint text-xs">{t("investments.figures.invested")}</dt>
              <dd>{empty ? <None /> : <MaskedMoney masked={privacy.masked} value={total.invested} fractionDigits={0} className="text-fg text-base md:text-lg" />}</dd>
            </div>
            <div className="flex flex-col gap-1 md:items-end">
              <dt className="text-fg-faint text-xs">{t("investments.figures.value")}</dt>
              <dd>{empty ? <None /> : <MaskedMoney masked={privacy.masked} value={total.value} fractionDigits={0} className="text-fg text-base md:text-lg" />}</dd>
            </div>
            <div className="flex flex-col gap-1 md:items-end">
              <dt className="text-fg-faint text-xs">{t("investments.figures.unrealised")}</dt>
              {empty ? (
                <dd><None /></dd>
              ) : (
                <dd className={`flex flex-wrap items-baseline gap-x-2 md:justify-end ${toneClass(total.gl)}`}>
                  <MaskedMoney masked={privacy.masked} value={total.gl} signed fractionDigits={0} className="text-base md:text-lg" />
                  <span className="font-mono text-xs md:text-sm">
                    (<Percent value={total.glPct} signed fractionDigits={1} />)
                  </span>
                </dd>
              )}
            </div>
          </dl>
        </div>
        <ExcludedNotes figures={total} className="mt-4" />
      </div>
    </Surface>
  );
}

function None() {
  return <span className="text-fg-faint text-base md:text-lg">—</span>;
}
