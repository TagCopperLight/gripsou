import { useTranslation } from "react-i18next";

/** §3.1 — outside any surface. */
export function ReviewProgress({ resolved, total }: { resolved: number; total: number }) {
  const { t } = useTranslation();
  const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-sm text-fg-dim">{t("budget.review.progress", { resolved, total })}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-green transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
