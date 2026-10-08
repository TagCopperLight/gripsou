import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { Money } from "../Money";
import { PrivateMoney } from "../PrivateMoney";
import { Percent } from "../Percent";
import { ReturnSpan } from "./ReturnSpan";
import { mutedToneClass, toneClass } from "../../lib/returns";
import type { InvestmentsData } from "../../pages/investments/mock";

type AnnualisedReturnCardProps = {
  data: InvestmentsData;
  className?: string;
};

/** The page's headline: the money-weighted return of everything invested,
 *  per year, with the plain figures it sits on to its right. */
export function AnnualisedReturnCard({ data, className = "" }: AnnualisedReturnCardProps) {
  const { t } = useTranslation();
  const { total, today } = data;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col gap-5 p-4 md:flex-row md:items-baseline-last md:justify-between md:p-5">
        <div className="flex flex-col gap-1">
          <p className="text-fg font-semibold text-sm">{t("investments.annualised.title")}</p>
          {total.annualised === null ? (
            <span className="text-[32px] font-semibold tracking-tight text-fg-faint md:text-[40px]">—</span>
          ) : (
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className="flex items-baseline whitespace-nowrap">
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
              </span>
              {total.since && <ReturnSpan since={total.since} today={today} className="text-sm" />}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-4 md:flex md:gap-10">
          <div className="flex flex-col gap-1 md:items-end">
            <dt className="text-fg-faint text-xs">{t("investments.figures.invested")}</dt>
            <dd><PrivateMoney value={total.invested} fractionDigits={0} className="text-fg text-base md:text-lg" /></dd>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <dt className="text-fg-faint text-xs">{t("investments.figures.value")}</dt>
            <dd><PrivateMoney value={total.value} fractionDigits={0} className="text-fg text-base md:text-lg" /></dd>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <dt className="text-fg-faint text-xs">{t("investments.figures.unrealised")}</dt>
            <dd className={`flex flex-wrap items-baseline gap-x-2 md:justify-end ${toneClass(total.gl)}`}>
              <Money value={total.gl} signed fractionDigits={0} className="text-base md:text-lg" />
              <span className="font-mono text-xs md:text-sm">
                (<Percent value={total.glPct} signed fractionDigits={1} />)
              </span>
            </dd>
          </div>
        </dl>
      </div>
    </Surface>
  );
}
