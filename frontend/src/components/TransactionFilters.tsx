import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";

import { Select } from "./Select";
import type { Account } from "../api/types";

const TYPES = [
  "deposit", "withdrawal", "buy", "sell", "dividend", "fee", "interest", "transfer",
];

export type Filters = {
  search: string;
  accountId: string;
  type: string;
  from: string;
  to: string;
};

type Props = {
  value: Filters;
  onChange: (next: Filters) => void;
  accounts: Account[];
};

export function TransactionFilters({ value, onChange, accounts }: Props) {
  const { t } = useTranslation();
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <label className="relative flex-1 min-w-48">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-fg-faint" />
        <input
          className="w-full pl-8 pr-3 py-2 rounded-xl bg-surface-2 text-fg text-sm"
          placeholder={t("transactions.search")}
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </label>
      <Select
        value={value.accountId}
        onChange={(v) => set({ accountId: v })}
        options={[
          { value: "", label: t("transactions.allAccounts") },
          ...accounts.map((a) => ({ value: a.id, label: a.name })),
        ]}
        className="w-48"
      />
      <Select
        value={value.type}
        onChange={(v) => set({ type: v })}
        options={[
          { value: "", label: t("transactions.allTypes") },
          ...TYPES.map((k) => ({ value: k, label: t(`transactions.types.${k}`) })),
        ]}
        className="w-40"
      />
      <input
        type="date"
        aria-label={t("transactions.from")}
        className="px-3 py-2 rounded-xl bg-surface-2 text-fg text-sm"
        value={value.from}
        onChange={(e) => set({ from: e.target.value })}
      />
      <input
        type="date"
        aria-label={t("transactions.to")}
        className="px-3 py-2 rounded-xl bg-surface-2 text-fg text-sm"
        value={value.to}
        onChange={(e) => set({ to: e.target.value })}
      />
    </div>
  );
}
