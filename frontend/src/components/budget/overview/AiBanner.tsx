import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, CircleAlert, Sparkles } from "lucide-react";

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
    // The error look (`ErrorState`), laid out as a row.
    const error = status.lastRun?.error ?? "";
    return (
      <Surface role="alert" className="flex items-center gap-3 px-5 py-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-soft text-red">
          <CircleAlert className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{t("budget.ai.failedTitle")}</p>
          <p title={error} className="truncate text-xs text-fg-faint">{error}</p>
        </div>
        <Button
          variant="outline"
          padded={false}
          className="rounded-lg! px-2.75 py-1.5 text-xs"
          disabled={retry.isPending}
          onClick={() => retry.mutate()}
        >
          {t("budget.ai.retry")}
        </Button>
      </Surface>
    );
  }

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

/** A run under way: a small pill at the end of the month line, so the page
 *  doesn't move down while the AI works. */
export function AiRunningPill() {
  const { t } = useTranslation();
  const status = useAiStatus().data;
  if (!status?.running) return null;
  return (
    <span role="status" className="ml-auto flex items-center gap-2.5 rounded-full bg-blue-soft py-1.75 pr-3.5 pl-3 text-[12.5px] text-blue">
      <Sparkles className="size-3.5 shrink-0 animate-pulse motion-reduce:animate-none" strokeWidth={2.25} aria-hidden />
      {t("budget.ai.running", { count: status.remaining })}
    </span>
  );
}
