import { useTranslation } from "react-i18next";

import { MaskedMoney } from "../../ui/MaskedMoney";
import { GainPill } from "../../ui/GainPill";
import { FxAsterisk } from "../../ui/FxNote";
import type { NetWorthSummary } from "../../api/types";
import type { Range } from "../../lib/ranges";

/** The net worth in large, its gain over the range in a pill, and the range
 *  in words. Asterisked when it leaves holdings out for want of a rate: its
 *  card's footnote says how many. */
export function NetWorthHeadline({ summary, range, masked }: { summary: NetWorthSummary; range: Range; masked: boolean }) {
  const { t } = useTranslation();
  return (
    <>
      <span className="relative w-fit">
        <MaskedMoney
          masked={masked}
          value={summary.netWorth}
          className="whitespace-nowrap text-[32px] font-semibold tracking-tight md:text-[40px]"
        />
        {summary.fxMissing && <FxAsterisk size="lg" />}
      </span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <GainPill value={summary.gainAbs} pct={summary.gainPct} masked={masked} />
        <p className="text-fg-faint text-sm">{t(`range.over.${range}`)}</p>
      </div>
    </>
  );
}
