import { useTranslation } from "react-i18next";

import { spanBetween } from "../../lib/span";

type ReturnSpanProps = {
  since: string;
  today: string;
  className?: string;
};

/** "1 yr 10 mo": the time an annualised figure covers. Under a year it turns
 *  amber: a few months' return, scaled to a year, can look far bigger than it
 *  is. */
export function ReturnSpan({ since, today, className = "" }: ReturnSpanProps) {
  const { t } = useTranslation();
  const span = spanBetween(since, today);
  const parts =
    span.years === 0 && span.months === 0
      ? [t("investments.span.days", { count: span.days })]
      : [
          span.years > 0 && t("investments.span.years", { count: span.years }),
          span.months > 0 && t("investments.span.months", { count: span.months }),
        ].filter(Boolean);
  return (
    <span
      className={`text-xs whitespace-nowrap ${span.years === 0 ? "text-amber" : "text-fg-faint"} ${className}`}
    >
      {parts.join(" ")}
    </span>
  );
}
