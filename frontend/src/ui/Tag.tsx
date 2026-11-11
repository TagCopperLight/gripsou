import type { ReactNode } from "react";

export type TagTone = "green" | "neutral";

const TONES: Record<TagTone, string> = {
  green: "bg-green-soft text-green",
  neutral: "bg-surface-3 text-fg-dim",
};

/** A short state beside a name: "This device", "You", "Ready". */
export function Tag({ tone, children }: { tone: TagTone; children: ReactNode }) {
  return (
    <span className={`shrink-0 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>
  );
}
