import { AccountsSummaryCard } from "./AccountsSummaryCard";
import { ConnectionAccountsCard } from "./ConnectionAccountsCard";
import { CardState } from "./CardState";
import { useAccounts } from "../api/hooks";
import { usePrivacy } from "../auth/usePrivacy";
import { groupByConnection } from "../lib/accounts";

type AccountsListProps = {
  className?: string;
};

/** The all-accounts summary, then one card per connection. */
export function AccountsList({ className = "" }: AccountsListProps) {
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

  // Shares are of what the accounts own, as on the dashboard's distribution:
  // an overdraft is not a slice of anything.
  const owned = data.reduce((sum, a) => sum + Math.max(0, Number(a.value)), 0);

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <AccountsSummaryCard accounts={data} privacy={privacy} />
      {groupByConnection(data).map((g) => (
        <ConnectionAccountsCard key={g.connectionId} group={g} owned={owned} masked={privacy.masked} />
      ))}
    </section>
  );
}
