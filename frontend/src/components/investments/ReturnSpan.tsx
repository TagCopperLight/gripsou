import { useTranslation } from "react-i18next";

import { spanBetween } from "../../lib/span";

type ReturnSpanProps = {
  since: string;
  today: string;
  className?: string;
};

/** "since Dec 2024 · 1 yr 10 mo": the time an annualised figure covers, which
 *  is what keeps a few months' return, scaled to a year, from misleading. */
export function ReturnSpan({ since, today, className = "" }: ReturnSpanProps) {
  const { t, i18n } = useTranslation();
  const span = spanBetween(since, today);
  const start = new Date(`${since}T00:00:00Z`).toLocaleDateString(i18n.language, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const parts =
    span.days > 0 || (span.years === 0 && span.months === 0)
      ? [t("investments.span.days", { count: span.days })]
      : [
          span.years > 0 && t("investments.span.years", { count: span.years }),
          span.months > 0 && t("investments.span.months", { count: span.months }),
        ].filter(Boolean);
  return (
    <span className={`text-fg-faint text-xs whitespace-nowrap ${className}`}>
      {t("investments.span.since", { date: start })} · {parts.join(" ")}
    </span>
  );
}
