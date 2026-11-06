import { useTranslation } from "react-i18next";

import { SegmentedControl } from "./SegmentedControl";
import { rangeOptions, type Range } from "../lib/ranges";

type RangeSelectorProps = { value: Range; onChange: (range: Range) => void; className?: string };

/** The chart range picker: 7D, 1M, … Max. */
export function RangeSelector({ value, onChange, className }: RangeSelectorProps) {
  const { t } = useTranslation();
  return <SegmentedControl options={rangeOptions(t)} value={value} onChange={onChange} className={className} />;
}

/** Phone: the ranges scroll on their own row, last in the card. */
export function PhoneRangeRow(props: Omit<RangeSelectorProps, "className">) {
  return (
    <div className="order-last -mx-1 mt-3 flex justify-center-safe overflow-x-auto px-1 md:hidden">
      <RangeSelector {...props} className="w-max" />
    </div>
  );
}
