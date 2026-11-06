import { useState } from "react";

import { TOTP_DIGITS } from "../api/wire";
import { codeDigits } from "../lib/mfa";

type CodeInputProps = {
  value: string;
  onChange: (digits: string) => void;
  ariaLabel: string;
  autoFocus?: boolean;
  /** The code was refused: every box gets a red ring. */
  invalid?: boolean;
};

/** An authenticator code shown one digit per box. It is a single real input laid
 *  invisibly over the boxes, so typing, pasting, autofill (one-time-code) and
 *  screen readers all treat it as one field. */
export function CodeInput({ value, onChange, ariaLabel, autoFocus, invalid = false }: CodeInputProps) {
  const [focused, setFocused] = useState(false);
  // The box the next digit goes into; the last one once all are typed.
  const active = Math.min(value.length, TOTP_DIGITS - 1);

  return (
    <div className="relative">
      <div className="flex justify-between gap-2" aria-hidden="true">
        {Array.from({ length: TOTP_DIGITS }, (_, i) => (
          <span
            key={i}
            className={`flex h-14 flex-1 items-center justify-center rounded-xl bg-surface-2 font-mono text-2xl text-fg transition-shadow duration-140 ${
              invalid ? "ring-1 ring-inset ring-red" : focused && i === active ? "ring-1 ring-inset ring-green" : ""
            }`}
          >
            {value[i] ?? ""}
          </span>
        ))}
      </div>
      <input
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        // No maxLength: the browser would cut a pasted "123 456" to "123 45"
        // before codeDigits could drop the space. codeDigits caps its length.
        value={value}
        onChange={(e) => onChange(codeDigits(e.target.value))}
        // A pasted whole code replaces what was there: the caret is pinned to
        // the end, so it would otherwise be appended and cut off.
        onPaste={(e) => {
          const pasted = codeDigits(e.clipboardData.getData("text"));
          if (pasted.length === TOTP_DIGITS) {
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
