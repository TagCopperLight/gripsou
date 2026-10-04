import { useTranslation } from "react-i18next";

import { Money } from "../Money";
import { getPrefs } from "../../lib/prefs";
import type { Transaction } from "../../api/types";

type TransactionAmountProps = {
  tx: Transaction;
  /** Classes for the main amount (size, colour, width). */
  className?: string;
};

/** A transaction's amount as it moved, in the ACCOUNT's own currency — never
 *  relabelled. When that currency is not the reader's, a faint line beneath
 *  gives its value in the reader's currency at the transaction's own date.
 *  Visible, not a tooltip: a foreign amount means nothing at a glance without
 *  it. With no rate for that day the server's figure is zero or in the pivot,
 *  so it is never printed; the line says the rate is missing instead. */
export function TransactionAmount({ tx, className = "" }: TransactionAmountProps) {
  const foreign = tx.currency !== getPrefs().currency;

  return (
    <span className="flex flex-col items-end">
      <Money value={tx.amount} currency={tx.currency} signed className={className} />
      {foreign && (
        <span data-testid="tx-amount-converted" className="text-xs text-fg-faint">
          {tx.fxMissing ? (
            <NoRate />
          ) : (
            <>
              {"≈ "}
              <Money value={tx.amountReporting} signed />
            </>
          )}
        </span>
      )}
    </span>
  );
}

/** Its own component so the translation hook runs only on the rare row that
 *  needs it: the transaction list counts on rows staying cheap to re-render. */
function NoRate() {
  const { t } = useTranslation();
  return t("budget.transactions.noRate");
}
