import { AccountCard } from "./AccountCard";
import { CardState } from "./CardState";
import { useAccounts } from "../api/hooks";

type AccountsListProps = {
  className?: string;
};

export function AccountsList({ className = "" }: AccountsListProps) {
  const { data, isError, refetch } = useAccounts();
  const ready = data !== undefined;
  const accounts = data ?? [];
  const total = accounts.reduce((sum, a) => sum + Number(a.value), 0);

  return (
    <section className={className}>
      <h2 className="text-fg font-semibold text-lg mb-3">All accounts</h2>
      {!ready ? (
        <CardState
          variant={isError ? "error" : "loading"}
          onRetry={() => refetch()}
          className="h-40"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              proportion={total > 0 ? Number(a.value) / total : 0}
            />
          ))}
        </div>
      )}
    </section>
  );
}
