import { AccountsSummaryCard } from "./AccountsSummaryCard";
import { ConnectionAccountsCard } from "./ConnectionAccountsCard";
import { CardState } from "../../ui/CardState";
import { useTranslation } from "react-i18next";

import { useAccounts } from "../../api/accounts";
import { usePrivacy } from "../../auth/usePrivacy";
import { accountTypeLabel, groupByConnection } from "../../lib/accounts";
import { sharesById } from "../../lib/distribution";

type AccountsListProps = {
  /** The account under the pointer (null when it leaves), for the chart. */
  onHover?: (accountId: string | null) => void;
  className?: string;
};

/** The all-accounts summary, then one card per connection. */
export function AccountsList({ onHover, className = "" }: AccountsListProps) {
  const { t } = useTranslation();
  const { data, isError, refetch } = useAccounts();
  // One eye, on the summary card, for every amount of the list.
  const privacy = usePrivacy();

  if (data === undefined) {
    return (
      <CardState
        variant={isError ? "error" : "loading"}
        onRetry={() => refetch()}
        className={`h-40 ${className}`}
      />
    );
  }

  // No accounts (nothing connected, a first sync running, or nothing came
  // in): the chart above already says so and what to do.
  if (data.length === 0) return null;

  // One width for the type tags on every card, so they line up page-wide.
  const tagCh = Math.max(0, ...data.map((a) => accountTypeLabel(t, a.typeKey).length));
  const shares = sharesById(data);

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <AccountsSummaryCard accounts={data} privacy={privacy} onHover={onHover} />
      {groupByConnection(data).map((g) => (
        <ConnectionAccountsCard key={g.connectionId} group={g} shares={shares} tagCh={tagCh} masked={privacy.masked} onHover={onHover} />
      ))}
    </section>
  );
}
