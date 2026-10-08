import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { Money } from "../Money";
import { PrivateMoney } from "../PrivateMoney";
import { Percent } from "../Percent";
import { ReturnSpan } from "./ReturnSpan";
import { toneClass } from "../../lib/returns";
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
  const missing = total.missing.length;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col gap-5 p-4 md:flex-row md:items-end md:justify-between md:p-5">
        <div className="flex flex-col gap-1">
          <p className="text-fg font-semibold text-sm">{t("investments.annualised.title")}</p>
          {total.annualised === null ? (
            <span className="text-[32px] font-semibold tracking-tight text-fg-faint md:text-[40px]">—</span>
          ) : (
            <span className="flex items-baseline gap-2">
              <Percent
                value={total.annualised}
                signed
                fractionDigits={1}
                className={`whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px] ${toneClass(total.annualised)}`}
              />
              <span className="text-fg-faint text-sm">{t("investments.annualised.perYear")}</span>
            </span>
          )}
          {total.since && <ReturnSpan since={total.since} today={today} />}
          {missing > 0 && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-fg-dim">
              <span className="size-2 shrink-0 rounded-full bg-amber" />
              {t("investments.missing.totalNote", { count: missing })}
            </p>
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
              <Percent value={total.glPct} signed fractionDigits={1} className="text-xs md:text-sm" />
            </dd>
          </div>
        </dl>
      </div>
    </Surface>
  );
}
