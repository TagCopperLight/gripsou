import { Check, Copy } from "lucide-react";

import { useCopy } from "../lib/useCopy";

/** A value to paste elsewhere, on one line in code style, with a button that
 *  copies it whole. `value` null is still on its way: `pending` shows in its
 *  place. */
export function CopyField({
  value,
  label,
  pending,
}: {
  value: string | null;
  /** The button's name for screen readers. */
  label: string;
  pending?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2">
      <code title={value ?? undefined} className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-sm text-fg">
        {value ?? pending}
      </code>
      <button
        type="button"
        onClick={() => value !== null && void copy(value)}
        disabled={value === null}
        aria-label={label}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface-2 text-fg transition-colors duration-140 hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
