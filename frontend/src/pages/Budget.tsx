import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../components/SegmentedControl";
import { BudgetProvider } from "../components/budget/BudgetProvider";

type Mode = "overview" | "transactions";

/** The one Budget page (§0). Modes live in the URL; the filters and the
 *  selection live in the provider, so they survive a mode switch (§2.5).
 *  The Review segment arrives in phase 5, conditional on a non-empty queue —
 *  the control already takes a variable option list and ReactNode labels. */
export function Budget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState().location.pathname;
  const mode: Mode = pathname.endsWith("/overview") ? "overview" : "transactions";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={t("nav.budget")} />
        <SegmentedControl<Mode>
          value={mode}
          onChange={(next) => navigate({ to: `/budget/${next}` })}
          options={[
            { value: "overview", label: t("budget.modes.overview") },
            { value: "transactions", label: t("budget.modes.transactions") },
          ]}
        />
      </div>
      <BudgetProvider>
        <Outlet />
      </BudgetProvider>
    </div>
  );
}
