import { useTranslation } from "react-i18next";

import { Money } from "./Money";
import type { Transaction } from "../api/types";

/** Date only — the ledger stores midnight for most rows, so a time column
 *  would show 00:00 on nearly everything. */
function formatDay(t: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(t));
}

export function TransactionsTable({ rows }: { rows: Transaction[] }) {
  const { t, i18n } = useTranslation();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-fg-faint">
          <th className="py-2 font-medium">{t("transactions.columns.date")}</th>
          <th className="py-2 font-medium">{t("transactions.columns.description")}</th>
          <th className="py-2 font-medium hidden md:table-cell">
            {t("transactions.columns.account")}
          </th>
          <th className="py-2 font-medium text-right">{t("transactions.columns.amount")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-surface-2">
            <td className="py-2 whitespace-nowrap">{formatDay(r.t, i18n.language)}</td>
            <td className="py-2">
              <div>{r.description}</div>
              <div className="text-xs text-fg-faint">
                {t(`transactions.types.${r.type}`, { defaultValue: r.type })}
              </div>
            </td>
            <td className="py-2 hidden md:table-cell">{r.accountName}</td>
            <td className="py-2 text-right tabular-nums">
              {/* amount is denominated in the ACCOUNT's own currency, not the
                  user's reporting currency — pass it through explicitly. */}
              <Money value={r.amount} currency={r.currency} signed />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
