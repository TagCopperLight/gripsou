import { AccountsSummaryCard } from "./AccountsSummaryCard";
import { ConnectionAccountsCard } from "./ConnectionAccountsCard";
import { CardError } from "../../ui/CardError";
import { AccountsListSkeleton } from "./AccountsListSkeleton";
import { useTranslation } from "react-i18next";

import { useAccounts } from "../../api/accounts";
import { usePrivacy } from "../../auth/usePrivacy";
import { accountTypeLabel, groupByConnection } from "../../lib/accounts";
import { sharesById } from "../../lib/distribution";

type AccountsListProps = {
  onHover?: (accountId: string | null) => void;
  className?: string;
};

export function AccountsList({ onHover, className = "" }: AccountsListProps) {
  const { t } = useTranslation();
  const { data, isPending, refetch } = useAccounts();
  const privacy = usePrivacy();

  if (isPending) return <AccountsListSkeleton className={className} />;
  if (data === undefined) {
    return (
      <CardError
        onRetry={() => refetch()}
        className={`h-40 ${className}`}
      />
    );
  }

  if (data.length === 0) return null;

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
