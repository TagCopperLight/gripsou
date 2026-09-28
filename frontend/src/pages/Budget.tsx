import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";

import { PageHeader } from "../components/PageHeader";
import { SegmentedControl, type SegmentedOption } from "../components/SegmentedControl";
import { BudgetProvider } from "../components/budget/BudgetProvider";
import { useAiStatus } from "../api/budget";

type Mode = "overview" | "transactions" | "review";

/** A bare `/budget` is Overview, the same default the router redirects to. */
function modeOf(pathname: string): Mode {
  if (pathname.endsWith("/transactions")) return "transactions";
  if (pathname.endsWith("/review")) return "review";
  return "overview";
}

/** The one Budget page. Modes live in the URL; the filters and the
 *  selection live in the provider, so they survive a mode switch.
 *  Review appears only while the queue is non-empty — and stays while the
 *  user is in it, so a queue drained in place can still show its success
 *  state instead of losing the selected segment. */
export function Budget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState().location.pathname;
  const mode = modeOf(pathname);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title={t("nav.budget")} />
        {/* The global SyncButton is pinned at the top-right of the page, outside
         *  this row; `clear-sync-button` keeps the control clear of its box
         *  instead of letting the two overlap. */}
        <SegmentedControl<Mode>
          className="clear-sync-button"
          value={mode}
          onChange={(next) => navigate({ to: `/budget/${next}` })}
          options={options}
        />
      </div>
      <BudgetProvider>
        <Outlet />
      </BudgetProvider>
    </div>
  );
}
