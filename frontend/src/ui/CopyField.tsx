import { Check, Copy } from "lucide-react";

import { useCopy } from "../lib/useCopy";
import { Skeleton, TextBone } from "./Skeleton";

export function CopyField({
  value,
  label,
}: {
  value: string | null;
  label: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-center gap-2">
      <code title={value ?? undefined} className="min-w-0 flex-1 truncate rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-sm text-fg">
        {value ?? (
          <Skeleton>
            <TextBone text="text-sm" className="w-3/5" />
          </Skeleton>
        )}
      </code>
      <button
        type="button"
        onClick={() => value !== null && void copy(value)}
        disabled={value === null}
        aria-label={label}
        className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-surface-2 text-fg transition-colors duration-140 enabled:hover:bg-surface-3"
      >
        {copied ? <Check className="size-4 text-green" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
