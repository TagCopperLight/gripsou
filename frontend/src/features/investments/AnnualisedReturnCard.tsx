import { useTranslation } from "react-i18next";

import { Surface } from "../../ui/Surface";
import { MaskedMoney } from "../../ui/MaskedMoney";
import { CardTitle } from "../../ui/CardTitle";
import { Percent } from "../../ui/Percent";
import { ReturnSpan } from "./ReturnSpan";
import { leavesOut, mutedToneClass, toneClass } from "../../lib/returns";
import { FxAsterisk } from "../../ui/FxNote";
import { ExcludedNotes } from "./ExcludedNotes";
import type { InvestmentReturns } from "../../api/wire";
import { usePrivacy } from "../../auth/usePrivacy";
import { Skeleton, TextBone } from "../../ui/Skeleton";

type AnnualisedReturnCardProps = {
  /** Undefined while loading: bones in place of the figures. */
  data?: InvestmentReturns;
  className?: string;
};

/** The page's headline: the money-weighted return of everything invested,
 *  per year, with the money it annualises to its right. */
export function AnnualisedReturnCard({ data, className = "" }: AnnualisedReturnCardProps) {
  const { t } = useTranslation();
  const privacy = usePrivacy();
  const total = data?.total;
  const partial = total !== undefined && leavesOut(total);
  // Every holding left out: the figures cover nothing, rather than read 0.
  const empty = partial && Number(total.invested) === 0 && Number(total.value) === 0;

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-baseline-last md:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle privacy={data !== undefined && privacy}>
              {t("investments.annualised.title")}
            </CardTitle>
            {data === undefined ? (
              <Skeleton>
                <TextBone text="text-[32px] md:text-[40px]" className="w-44 md:w-56" />
              </Skeleton>
            ) : data.total.annualised === null ? (
              <span className="relative w-fit text-[32px] font-semibold tracking-tight text-fg-faint md:text-[40px]">
                —
                {partial && <FxAsterisk size="lg" />}
              </span>
            ) : (
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="relative flex items-baseline whitespace-nowrap">
                  <Percent
                    value={data.total.annualised}
                    signed
                    fractionDigits={1}
                    className={`text-[32px] font-semibold tracking-tight md:text-[40px] ${toneClass(data.total.annualised)}`}
                  />
                  {/* /yr at 65% of the figure's size. */}
                  <span className={`ml-1 font-mono text-[21px] md:text-[26px] ${mutedToneClass(data.total.annualised)}`}>
                    {t("investments.returns.perYearShort")}
                  </span>
                  {partial && <FxAsterisk size="lg" />}
                </span>
                {data.total.since && <ReturnSpan since={data.total.since} today={data.today} className="text-sm" />}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-4 md:flex md:gap-10">
            {(["invested", "received", "value"] as const).map((key) => (
              <div key={key} className="flex flex-col gap-1 md:items-end">
                <dt className="text-fg-faint text-xs">{t(`investments.figures.${key}`)}</dt>
                <dd>
                  {total === undefined ? (
                    <FigureBone />
                  ) : empty || total[key] === null ? (
                    <None />
                  ) : (
                    <MaskedMoney masked={privacy.masked} value={total[key]} fractionDigits={0} className="text-fg text-base md:text-lg" />
                  )}
                </dd>
              </div>
            ))}
            <div className="flex flex-col gap-1 md:items-end">
              <dt className="text-fg-faint text-xs">{t("investments.figures.gain")}</dt>
              {total === undefined ? (
                <dd><FigureBone /></dd>
              ) : empty || total.gain === null || total.gainPct === null ? (
                <dd><None /></dd>
              ) : (
                <dd className={`flex flex-wrap items-baseline gap-x-2 md:justify-end ${toneClass(total.gain)}`}>
                  <MaskedMoney masked={privacy.masked} value={total.gain} signed fractionDigits={0} className="text-base md:text-lg" />
                  <span className="font-mono text-xs md:text-sm">
                    (<Percent value={total.gainPct} signed fractionDigits={1} />)
                  </span>
                </dd>
              )}
            </div>
          </dl>
        </div>
        {total && <ExcludedNotes figures={total} className="mt-4" />}
      </div>
    </Surface>
  );
}

function FigureBone() {
  return (
    <Skeleton>
      <TextBone text="text-base md:text-lg" className="w-20" />
    </Skeleton>
  );
}

function None() {
  return <span className="text-fg-faint text-base md:text-lg">—</span>;
}
