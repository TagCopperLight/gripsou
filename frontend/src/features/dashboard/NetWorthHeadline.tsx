import { useTranslation } from "react-i18next";

import { MaskedMoney } from "../../ui/MaskedMoney";
import { GainPill } from "../../ui/GainPill";
import { FxAsterisk } from "../../ui/FxNote";
import { Bone, Skeleton, TextBone } from "../../ui/Skeleton";
import type { NetWorthSummary } from "../../api/wire";
import type { Range } from "../../api/wire";

const FIGURE = "text-[32px] md:text-[40px]";

/** The net worth in large, its gain over the range in a pill, and the range
 *  in words. Asterisked when it leaves holdings out for want of a rate: its
 *  card's footnote says how many. Without a `summary` (still loading), bones
 *  where the figures go; the range in words is known already. */
export function NetWorthHeadline({ summary, range, masked }: { summary?: NetWorthSummary; range: Range; masked: boolean }) {
  const { t } = useTranslation();
  const over = <p className="text-fg-faint text-sm">{t(`range.over.${range}`)}</p>;
  if (summary === undefined) {
    return (
      <>
        <Skeleton>
          <TextBone text={FIGURE} className="w-56 md:w-72" />
        </Skeleton>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* The pill's own height: a text-sm line and its py-1. */}
          <Skeleton>
            <Bone className="h-7 w-48 rounded-lg" />
          </Skeleton>
          {over}
        </div>
      </>
    );
  }
  return (
    <>
      <span className="relative w-fit">
        <MaskedMoney
          masked={masked}
          value={summary.netWorth}
          className={`whitespace-nowrap ${FIGURE} font-semibold tracking-tight`}
        />
        {summary.fxMissing && <FxAsterisk size="lg" />}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <GainPill value={summary.gainAbs} pct={summary.gainPct} masked={masked} />
        {over}
      </div>
    </>
  );
}
