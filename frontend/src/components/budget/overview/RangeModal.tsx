import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";

import { Dialog as BudgetDialog } from "../../Dialog";
import { Button } from "../../Button";
import { presetRange, type RangePreset } from "../../../lib/period";

type RangeModalProps = {
  onApply: (range: { from: string; to: string }) => void;
  onClose: () => void;
};

const PRESETS: RangePreset[] = ["last3Months", "last6Months", "last12Months", "thisYear", "lastYear"];

export function RangeModal({ onApply, onClose }: RangeModalProps) {
  const { t } = useTranslation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const customValid = from !== "" && to !== "" && from <= to;

  return (
    <BudgetDialog
      title={t("budget.overview.customRange")}
      icon={<Calendar className="size-4" />}
      onClose={onClose}
      footer={
        <Button disabled={!customValid} onClick={() => onApply({ from, to })}>
          {t("budget.overview.apply")}
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-1">
        {PRESETS.map((key) => (
          <button
            key={key}
            type="button"
            className="cursor-pointer rounded-lg px-3 py-2 text-left text-sm text-fg-dim transition-colors duration-140 hover:bg-fg/6 hover:text-fg"
            onClick={() => onApply(presetRange(key))}
          >
            {t(`budget.overview.presets.${key}`)}
          </button>
        ))}
      </div>
      <div className="my-3 h-px bg-fg/8" />
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-faint">
          {t("budget.overview.from")}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm text-fg"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-faint">
          {t("budget.overview.to")}
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full rounded-lg bg-surface-2 px-2.5 py-1.5 text-sm text-fg"
          />
        </label>
      </div>
    </BudgetDialog>
  );
}
