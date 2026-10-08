import { useTranslation } from "react-i18next";

import { spanBetween } from "../../lib/span";

type ReturnSpanProps = {
  since: string;
  today: string;
  /** Size (and spacing) classes; defaults to text-xs. */
  className?: string;
};

/** "over 1 yr 10 mo": the time an annualised figure covers. Under a year it turns
 *  amber: a few months' return, scaled to a year, can look far bigger than it
 *  is. */
export function ReturnSpan({ since, today, className = "text-xs" }: ReturnSpanProps) {
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
      className={`whitespace-nowrap ${span.years === 0 ? "text-amber" : "text-fg-faint"} ${className}`}
    >
      {t("investments.span.over", { span: parts.join(" ") })}
    </span>
  );
}
