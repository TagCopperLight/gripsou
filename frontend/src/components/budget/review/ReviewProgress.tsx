import { Trans } from "react-i18next";

/** §3.1 — outside any surface. */
export function ReviewProgress({ resolved, total }: { resolved: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((resolved / total) * 100);
  return (
    <div className="flex items-center gap-3">
      <span data-testid="review-progress" className="font-mono text-sm text-fg-dim">
        <Trans
          i18nKey="budget.review.progress"
          values={{ resolved, total }}
          components={{ done: <span className="text-fg" /> }}
        />
      </span>
      <div className="h-1.5 w-1/2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-green transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
