import { useTranslation } from "react-i18next";

import { Surface } from "../Surface";
import { Money } from "../Money";
import { Percent } from "../Percent";
import { ReturnSpan } from "./ReturnSpan";
import { mutedToneClass, toneClass } from "../../lib/returns";
import type { InvestmentsData, ReturnAccount } from "../../pages/investments/mock";

const HIDDEN_ON_PHONE = "hidden md:table-cell";

type ReturnsCardProps = {
  data: InvestmentsData;
  className?: string;
};

/** One row per account holding securities: its annualised return and the
 *  figures it sits on. */
export function ReturnsCard({ data, className = "" }: ReturnsCardProps) {
  const { t } = useTranslation();

  const head = (key: string, desktopOnly = false, left = false) => (
    <th
      className={`pb-2 px-2 md:px-3 text-[11px] font-medium tracking-wide font-mono whitespace-nowrap text-fg-faint ${
        left ? "text-left" : "text-right"
      } ${desktopOnly ? HIDDEN_ON_PHONE : ""}`}
    >
      {t(key)}
    </th>
  );

  return (
    <Surface className={`w-full ${className}`}>
      <div className="flex flex-col p-4 md:p-5">
        <p className="text-fg font-semibold text-sm">{t("investments.returns.title")}</p>
        <table className="mt-4 w-full border-separate border-spacing-0">
          <thead>
            <tr>
              {head("investments.returns.account", false, true)}
              {head("investments.returns.annualised")}
              {head("investments.returns.invested", true)}
              {head("investments.returns.value", true)}
              {head("investments.returns.unrealised", true)}
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((a) => (
              <AccountRow key={a.id} account={a} today={data.today} />
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

function AccountRow({ account: a, today }: { account: ReturnAccount; today: string }) {
  const { t } = useTranslation();
  const cell = "py-3 px-2 md:px-3 border-t border-surface-2";
  const missing = a.missing.length;

  return (
    <tr>
      {/* ACCOUNT */}
      <td className={`${cell} max-w-0 w-full`}>
        <div className="flex items-center gap-3">
          <span className="relative shrink-0">
            <span className="block size-3 rounded-[4px]" style={{ background: a.color }} />
            {missing > 0 && (
              <span className="absolute -top-1 -right-1 size-2 rounded-full bg-amber ring-2 ring-surface" />
            )}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="truncate text-sm text-fg">{a.name}</span>
              <span className="hidden text-fg-faint text-xs whitespace-nowrap sm:inline">{a.source}</span>
            </span>
            {missing > 0 && (
              // MOCKUP: will open the record-purchases modal for these holdings.
              <button
                type="button"
                title={a.missing.map((m) => m.name).join(", ")}
                className="mt-0.5 self-start cursor-pointer text-left text-xs text-amber hover:underline"
              >
                {t("investments.missing.accountNote", { count: missing })}
              </button>
            )}
          </div>
        </div>
      </td>
      {/* ANNUALISED */}
      <td className={`${cell} text-right whitespace-nowrap align-top md:align-middle`}>
        {a.annualised === null ? (
          <div className="flex flex-col items-end">
            <span className="text-sm text-fg-faint">—</span>
            <span className="text-xs text-fg-faint">{t("investments.missing.noReturn")}</span>
          </div>
        ) : (
          <div className="flex flex-col items-end">
            <span className="flex items-baseline">
              <Percent value={a.annualised} signed fractionDigits={1} className={`text-sm ${toneClass(a.annualised)}`} />
              <span className={`font-mono text-[11px] ${mutedToneClass(a.annualised)}`}>
                {t("investments.returns.perYearShort")}
              </span>
            </span>
            {a.since && <ReturnSpan since={a.since} today={today} className="text-[11px]" />}
          </div>
        )}
      </td>
      {/* INVESTED */}
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        <Money value={a.invested} className="text-sm text-fg-dim" />
      </td>
      {/* VALUE */}
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        <Money value={a.value} className="text-sm text-fg" />
      </td>
      {/* UNREALISED */}
      <td className={`${cell} text-right whitespace-nowrap ${HIDDEN_ON_PHONE}`}>
        <div className={`flex flex-col items-end ${toneClass(a.gl)}`}>
          <Money value={a.gl} signed className="text-sm" />
          <Percent value={a.glPct} signed fractionDigits={1} className="text-xs" />
        </div>
      </td>
    </tr>
  );
}
