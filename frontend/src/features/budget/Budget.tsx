import { Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";

import { PageHeader } from "../../ui/PageHeader";
import { SegmentedControl, type SegmentedOption } from "../../ui/SegmentedControl";
import { BudgetProvider } from "./BudgetProvider";
import { useAiStatus } from "../../api/budget";

const MODE_PATHS = {
  overview: "/budget/overview",
  transactions: "/budget/transactions",
  review: "/budget/review",
} as const;

type Mode = keyof typeof MODE_PATHS;

/** The one Budget page. Modes live in the URL; the filters and the
 *  selection live in the provider, so they survive a mode switch.
 *  Review appears only while the queue is non-empty — and stays while the
 *  user is in it, so a queue drained in place can still show its success
 *  state instead of losing the selected segment. */
export function Budget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  // A bare `/budget` is Overview, the same default the router redirects to.
  const mode = (["transactions", "review"] as const).find((m) => matchRoute({ to: MODE_PATHS[m] })) ?? "overview";
  const reviewCount = useAiStatus().data?.reviewCount ?? 0;

  const options: SegmentedOption<Mode>[] = [
    { value: "overview", label: t("budget.modes.overview") },
    { value: "transactions", label: t("budget.modes.transactions") },
  ];
  if (reviewCount > 0 || mode === "review") {
    const attention = reviewCount > 0 && mode !== "review";
    options.push({
      value: "review",
      label: attention ? (
        <span data-testid="review-segment" className="inline-flex items-center gap-1 text-amber">
          <Sparkles className="size-3.5" strokeWidth={1.5} aria-hidden />
          {reviewCount}
        </span>
      ) : (
        t("budget.modes.review")
      ),
      className: attention ? "bg-amber-soft" : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("nav.budget")}>
        {/* The global SyncButton is pinned at the top-right of the page, outside
         *  this row; `clear-sync-button` keeps the control clear of its box
         *  instead of letting the two overlap. */}
        <SegmentedControl<Mode>
          className="clear-sync-button"
          value={mode}
          onChange={(next) => navigate({ to: MODE_PATHS[next] })}
          options={options}
        />
      </PageHeader>
      <BudgetProvider>
        <Outlet />
      </BudgetProvider>
    </div>
  );
}
