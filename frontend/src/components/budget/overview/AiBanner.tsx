import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, LoaderCircle, Sparkles, TriangleAlert } from "lucide-react";

import { Surface } from "../../Surface";
import { Button } from "../../Button";
import { useAiStatus, useRequestCategorize } from "../../../api/budget";
import { bannerVariant } from "../../../lib/aiBanner";

/** The AI notification surface: only when there is something to do. */
export function AiBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useAiStatus().data;
  const retry = useRequestCategorize();
  const variant = bannerVariant(status);
  if (!status || !variant) return null;

  if (variant === "failed") {
    return (
      <Surface className="flex items-center gap-3 px-5 py-4">
        <TriangleAlert className="size-5 shrink-0 text-red" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{t("budget.ai.failedTitle")}</p>
          <p className="truncate text-xs text-fg-faint">{status.lastRun?.error}</p>
        </div>
        <Button variant="ghostStrong" disabled={retry.isPending} onClick={() => retry.mutate()}>
          {t("budget.ai.retry")}
        </Button>
      </Surface>
    );
  }

  if (variant === "review") {
    return (
      <Surface className="flex items-center gap-3 px-5 py-4">
        <Sparkles className="size-5 shrink-0 text-amber" strokeWidth={1.5} aria-hidden />
        <p className="flex-1 text-sm text-fg">{t("budget.ai.reviewNeeded", { count: status.reviewCount })}</p>
        <Button
          variant="amber"
          className="inline-flex items-center gap-1"
          onClick={() => navigate({ to: "/budget/review" })}
        >
          {t("budget.ai.reviewCta", { count: status.reviewCount })}
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </Surface>
    );
  }

  return (
    <p role="status" className="flex items-center gap-2 px-1 text-sm text-fg-faint">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      {t("budget.ai.running", { count: status.remaining })}
    </p>
  );
}
