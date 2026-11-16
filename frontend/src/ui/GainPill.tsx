import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { MaskedMoney } from "./MaskedMoney";
import { Percent } from "./Percent";

export function GainPill({ value, pct, masked, currency }: {
  value: string | number;
  pct: string | number;
  masked: boolean;
  currency?: string;
}) {
  const up = Number(value) >= 0;
  return (
    <div className={`flex self-start items-center gap-1 whitespace-nowrap py-1 px-2 rounded-lg text-sm ${up ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
      {up ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
      <MaskedMoney masked={masked} value={value} currency={currency} signed />
      <span className="font-mono ml-2">(<Percent value={pct} signed />)</span>
    </div>
  );
}
