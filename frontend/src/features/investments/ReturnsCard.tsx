import { useTranslation } from "react-i18next";

import { Surface } from "../../ui/Surface";
import { MaskedMoney } from "../../ui/MaskedMoney";
import { CardTitle } from "../../ui/CardTitle";
import { Percent } from "../../ui/Percent";
import { ReturnSpan } from "./ReturnSpan";
import { leavesOut, mutedToneClass, toneClass } from "../../lib/returns";
import { FxAsterisk } from "../../ui/FxNote";
import { ExcludedNotes } from "./ExcludedNotes";
import type { InvestmentReturns, ReturnAccount } from "../../api/wire";
import { usePrivacy } from "../../auth/usePrivacy";
import { HEAD_TEXT } from "../../ui/gridTable";

const HIDDEN_ON_PHONE = "hidden md:table-cell";
// The figure columns get a wide left gutter so they don't run together.
const PAD_TEXT = "px-2 md:px-3";
const PAD_FIGURE = "pl-4 pr-2 md:pl-10 md:pr-3";

type ReturnsCardProps = {
  data: InvestmentReturns;
  className?: string;
};

/** One row per account holding securities: its annualised return and the
 *  money it annualises (put in, received, held, gained). */
export function ReturnsCard({ data, className = "" }: ReturnsCardProps) {
  const { t } = useTranslation();
  const privacy = usePrivacy();

  const head = (key: string, desktopOnly = false, left = false) => (
    <th
      className={`pb-2 whitespace-nowrap ${HEAD_TEXT} ${
        left ? `text-left ${PAD_TEXT}` : `text-right ${PAD_FIGURE}`
      } ${desktopOnly ? HIDDEN_ON_PHONE : ""}`}
    >
      {t(key)}
    </th>
  );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <CardTitle privacy={privacy}>
          {t("investments.returns.title")}
        </CardTitle>
        <table className="mt-4 w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {head("investments.returns.account", false, true)}
              {head("investments.returns.annualised")}
              {head("investments.returns.invested", true)}
              {head("investments.returns.received", true)}
              {head("investments.returns.value", true)}
              {head("investments.returns.gain", true)}
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <AccountRow key={a.id} account={a} today={data.today} masked={privacy.masked} />
            ))}
          </tbody>
        </table>
        <ExcludedNotes figures={data.total} className="mt-4" />
      </div>
    </Surface>
  );
}

function AccountRow({ account: a, today, masked }: { account: ReturnAccount; today: string; masked: boolean }) {
  const { t } = useTranslation();
  const row = "py-3 border-t border-surface-2";
  const cell = `${row} ${PAD_FIGURE}`;
  const missing = a.missing.length;
  const partial = leavesOut(a);
  // Every holding left out: the figures cover nothing, rather than read 0.
  const empty = partial && Number(a.invested) === 0 && Number(a.value) === 0;
  // A dash, not a guess, when the figure is unknown (a rate is missing).
  const money = (value: string | null, className: string) =>
    empty || value === null ? none : <MaskedMoney masked={masked} value={value} className={className} />;
  const none = <span className="text-sm text-fg-faint">—</span>;

  return (
    <tr>
      <td className={`${row} ${PAD_TEXT} max-w-0 w-full`}>
        <div className="flex items-center gap-3">
          <span className="relative shrink-0">
            <span className="block size-3 rounded-[4px]" style={{ background: a.color }} />
            {missing > 0 && (
              <span
                title={t("investments.missing.dotTitle", { names: a.missing.map((m) => m.name).join(", ") })}
                className="absolute -top-1 -right-1 size-2 rounded-full bg-amber ring-2 ring-surface"
              />
            )}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="truncate text-sm text-fg">{a.name}</span>
              <span className="hidden text-fg-faint text-xs whitespace-nowrap sm:inline">{a.source}</span>
            </span>
          </div>
        </div>
      </td>
      <td className={`${cell} text-right whitespace-nowrap align-top md:align-middle`}>
        {a.annualised === null ? (
          <div className="flex flex-col items-end">
            <span className="relative text-sm text-fg-faint">
              —
              {partial && <FxAsterisk />}
            </span>
            {a.since === null && a.excludedHistory > 0 && (
              <span className="text-xs text-fg-faint">{t("investments.missing.noReturn")}</span>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="relative flex items-baseline">
              <Percent value={a.annualised} signed fractionDigits={1} className={`text-sm ${toneClass(a.annualised)}`} />
              <span className={`ml-0.5 font-mono text-[11px] ${mutedToneClass(a.annualised)}`}>
                {t("investments.returns.perYearShort")}
              </span>
              {partial && <FxAsterisk />}
            </span>
            {a.since && <ReturnSpan since={a.since} today={today} className="text-[11px]" />}
          </div>
        )}
      </td>
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        {money(a.invested, "text-sm text-fg-dim")}
      </td>
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        {money(a.received, "text-sm text-fg-dim")}
      </td>
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        {money(a.value, "text-sm text-fg")}
      </td>
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        {empty || a.gain === null || a.gainPct === null ? none : (
          <div className={`flex flex-col items-end ${toneClass(a.gain)}`}>
            <MaskedMoney masked={masked} value={a.gain} signed className="text-sm" />
            <Percent value={a.gainPct} signed fractionDigits={1} className="text-xs" />
          </div>
        )}
      </td>
    </tr>
  );
}
