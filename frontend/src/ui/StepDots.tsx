import { useTranslation } from "react-i18next";

/** Where a multi-step flow is: one bar per step, filled up to the current one. */
export function StepDots({ current, total }: { current: number; total: number }) {
  const { t } = useTranslation();
  return (
    <span role="img" className="flex gap-1.5" aria-label={t("common.stepOf", { step: current + 1, total })}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-1.5 w-5 rounded-full ${i <= current ? "bg-green" : "bg-surface-3"}`} />
      ))}
    </span>
  );
}
