import { AccountsSummaryCard } from "./AccountsSummaryCard";
import { ConnectionAccountsCard } from "./ConnectionAccountsCard";
import { CardState } from "./CardState";
import { useAccounts } from "../api/hooks";
import { groupByConnection } from "../lib/accounts";

type AccountsListProps = {
  className?: string;
};

/** The all-accounts summary, then one card per connection. */
export function AccountsList({ className = "" }: AccountsListProps) {
  const { data, isError, refetch } = useAccounts();

  if (data === undefined) {
    return (
      <CardState
        variant={isError ? "error" : "loading"}
        onRetry={() => refetch()}
        className={`h-40 ${className}`}
      />
    );
  }

  const netWorth = data.reduce((sum, a) => sum + Number(a.value), 0);

  return (
    <section className={`flex flex-col gap-4 ${className}`}>
      <AccountsSummaryCard accounts={data} />
      {groupByConnection(data).map((g) => (
        <ConnectionAccountsCard key={g.connectionId} group={g} netWorth={netWorth} />
      ))}
    </section>
  );
}
