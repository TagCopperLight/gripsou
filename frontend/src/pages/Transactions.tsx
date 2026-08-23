import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { Surface } from "../components/Surface";
import { CardState } from "../components/CardState";
import { Button } from "../components/Button";
import { TransactionsTable } from "../components/TransactionsTable";
import { TransactionFilters, type Filters } from "../components/TransactionFilters";
import { useAccounts, useTransactions } from "../api/hooks";

const EMPTY: Filters = { search: "", accountId: "", type: "", from: "", to: "" };

/** Delays the query-facing value by `delay`ms, without ever delaying `value`
 *  itself — callers keep the raw value for a fully responsive input and use
 *  the debounced one only for the expensive operation (here, a fetch). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function Transactions() {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const accounts = useAccounts();
  const q = useTransactions({
    search: debouncedSearch || undefined,
    accountId: filters.accountId || undefined,
    type: filters.type || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  });

  const ready = q.data !== undefined;
  const rows = q.data?.pages.flat() ?? [];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("nav.transactions")} />
      <Surface className="flex flex-col gap-4 p-4">
        <TransactionFilters
          value={filters}
          onChange={setFilters}
          accounts={accounts.data ?? []}
        />
        {!ready ? (
          <CardState
            variant={q.isError ? "error" : "loading"}
            onRetry={() => q.refetch()}
            className="h-40"
          />
        ) : rows.length === 0 ? (
          <p className="text-fg-faint text-sm">{t("transactions.empty")}</p>
        ) : (
          <>
            <TransactionsTable rows={rows} />
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-fg-faint text-xs">
                {t("transactions.shown", { count: rows.length })}
              </p>
              {q.hasNextPage && (
                <Button
                  variant="ghost"
                  onClick={() => q.fetchNextPage()}
                  disabled={q.isFetchingNextPage}
                >
                  {q.isFetchingNextPage
                    ? t("transactions.loadingMore")
                    : t("transactions.loadMore")}
                </Button>
              )}
            </div>
          </>
        )}
      </Surface>
    </div>
  );
}
