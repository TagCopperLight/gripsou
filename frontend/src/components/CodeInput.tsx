import { useState } from "react";

import { sixDigits } from "../lib/mfa";

type CodeInputProps = {
  value: string;
  onChange: (digits: string) => void;
  ariaLabel: string;
  autoFocus?: boolean;
};

/** A 6-digit code shown one digit per box. It is a single real input laid
 *  invisibly over the boxes, so typing, pasting, autofill (one-time-code) and
 *  screen readers all treat it as one field. */
export function CodeInput({ value, onChange, ariaLabel, autoFocus }: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  // The box the next digit goes into; the last one once all six are typed.
  const active = Math.min(value.length, 5);

  return (
    <div className="relative">
      <div className="flex justify-between gap-2" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <span
            key={i}
            className={`flex h-14 flex-1 items-center justify-center rounded-xl bg-surface-2 font-mono text-2xl text-fg transition-shadow duration-140 ${
              focused && i === active ? "ring-1 ring-green" : ""
            }`}
          >
            {value[i] ?? ""}
          </span>
        ))}
      </div>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        data-autofocus={autoFocus ? "" : undefined}
        // No maxLength: the browser would cut a pasted "123 456" to "123 45"
        // before sixDigits could drop the space. sixDigits caps it at six.
        value={value}
        onChange={(e) => onChange(sixDigits(e.target.value))}
        // A pasted whole code replaces what was there: the caret is pinned to
        // the end, so it would otherwise be appended and cut off.
        onPaste={(e) => {
          const pasted = sixDigits(e.clipboardData.getData("text"));
          if (pasted.length === 6) {
            e.preventDefault();
            onChange(pasted);
          }
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // Keep the caret at the end: digits are always added or removed there.
        onSelect={(e) => {
          const el = e.currentTarget;
          if (el.selectionStart !== el.value.length) el.setSelectionRange(el.value.length, el.value.length);
        }}
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
      />
    </div>
  );
}
