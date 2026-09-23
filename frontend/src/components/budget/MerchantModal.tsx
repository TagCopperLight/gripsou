import { useState } from "react";
import { useTranslation } from "react-i18next";

import { BudgetDialog } from "./BudgetDialog";
import { TransactionAvatar } from "./TransactionAvatar";
import { Button } from "../Button";
import { useMerchantLogoPreview, useSetMerchant } from "../../api/budget";
import { ApiError } from "../../api/client";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import type { Transaction } from "../../api/types";

/** One correction per description (spec §7): the memo is keyed on the
 *  normalised wording, so saving here fixes every row that shares it. The
 *  preview is the avatar itself, fed the would-be domain. */
export function MerchantModal({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  const { t } = useTranslation();
  const save = useSetMerchant();
  const [name, setName] = useState(tx.merchantName ?? "");
  const [domain, setDomain] = useState(tx.merchantDomain ?? "");
  const [errorKey, setErrorKey] = useState<"invalidDomain" | "noIdentity" | "saveFailed" | null>(null);

  const d = domain.trim().toLowerCase();
  // Unchanged from the row's current domain: reuse its logo URL as-is — it
  // may carry a Brandfetch client-id query string a freshly-built preview
  // wouldn't have — rather than firing a request for what we already know.
  const unchanged = Boolean(d) && d === tx.merchantDomain;
  const debouncedDomain = useDebouncedValue(d, 300);
  const previewQuery = useMerchantLogoPreview(unchanged ? "" : debouncedDomain);
  // Empty domain, or a pending/failed preview: no logo (the avatar falls
  // back to the category icon). A stale in-flight preview for a domain the
  // user has since changed is not shown either — only the debounced value's
  // own result is trusted, and react-query keys it by that value already.
  const previewLogo = !d
    ? null
    : unchanged
      ? tx.merchantLogoUrl
      : (previewQuery.data?.logoUrl ?? null);
  const preview: Transaction = { ...tx, merchantLogoUrl: previewLogo };

  const submit = () => {
    setErrorKey(null);
    save.mutate(
      { transactionId: tx.id, name: name.trim() || null, domain: d || null },
      {
        onSuccess: onClose,
        onError: (err) => {
          if (err instanceof ApiError && err.status === 400) return setErrorKey("invalidDomain");
          if (err instanceof ApiError && err.status === 422) return setErrorKey("noIdentity");
          setErrorKey("saveFailed");
        },
      },
    );
  };

  return (
    <BudgetDialog
      title={t("budget.merchant.title")}
      heading={
        <span className="flex items-center gap-3">
          <TransactionAvatar key={preview.merchantLogoUrl ?? "none"} tx={preview} />
          <span className="truncate uppercase">{tx.description}</span>
        </span>
      }
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t("budget.merchant.cancel")}</Button>
          <Button variant="primary" disabled={save.isPending} onClick={submit}>{t("budget.merchant.save")}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="merchant-name" className="text-sm text-fg">{t("budget.merchant.name")}</label>
          <input id="merchant-name" className="rounded-xl bg-surface-2 px-3.5 py-2 text-sm text-fg" value={name}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="merchant-domain" className="text-sm text-fg">{t("budget.merchant.domain")}</label>
          <input id="merchant-domain" className="rounded-xl bg-surface-2 px-3.5 py-2 font-mono text-sm text-fg" value={domain}
            onChange={(e) => setDomain(e.target.value)} />
          <span className="text-xs text-fg-faint">{t("budget.merchant.domainHint")}</span>
        </div>
        {errorKey && <p className="text-sm text-red">{t(`budget.merchant.${errorKey}`)}</p>}
      </div>
    </BudgetDialog>
  );
}
