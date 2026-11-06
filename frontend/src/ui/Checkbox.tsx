import { Check } from "lucide-react";

type CheckboxProps = {
  checked: boolean;
  onChange: () => void;
  /** Accessible name: these never sit next to a visible `<label>`. */
  label: string;
  "data-testid"?: string;
  /** Extra classes for the box itself — visibility (opacity), mostly. */
  className?: string;
  /** "solid" fills green when checked, for a deliberate act like selecting a
   *  row. "soft" only tints, for a marker that sits ticked on many rows at
   *  once and would otherwise shout. */
  tone?: "solid" | "soft";
};

const TONE = {
  solid: "peer-checked:border-green peer-checked:bg-green peer-checked:text-black/80",
  soft: "peer-checked:border-green/40 peer-checked:bg-green-soft peer-checked:text-green",
} as const;

/** The app's checkbox: a rounded square on the card surface with a faint edge
 *  that lifts to `fg-faint` while the pointer is on it, filling green when
 *  checked. The native input stays in the DOM, unstyled and
 *  transparent on top of the box, so focus, keyboard and testing-library's
 *  `getByRole("checkbox")` all keep working — only the paint is ours. */
export function Checkbox({
  checked, onChange, label, className = "", tone = "solid", ...rest
}: CheckboxProps) {
  return (
    <span className={`relative inline-flex size-4.5 shrink-0 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        data-testid={rest["data-testid"]}
        className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-[5px]"
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none flex size-4.5 items-center justify-center rounded-[5px] border-[1.5px] border-surface-3 bg-surface text-transparent transition-colors duration-140 peer-[:hover:not(:checked)]:border-fg-faint peer-focus-visible:ring-2 peer-focus-visible:ring-green/40 ${TONE[tone]}`}
      >
        <Check className="size-3" strokeWidth={3.5} />
      </span>
    </span>
  );
}
