import type { ReactNode } from "react";

/** An amount with a second figure that shows only while the amount itself is
 *  hovered, in a small bubble beside it; the hand cursor says there is one. CSS-only (no state), so a long list
 *  of rows re-renders no more than before. No hint, no bubble. */
export function MoneyHint({ hint, side = "left", children }: {
  hint: ReactNode | null;
  side?: "left" | "right";
  children: ReactNode;
}) {
  if (hint === null) return children;
  return (
    <span className="group/hint relative cursor-pointer">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-1/2 z-10 hidden h-6 -translate-y-1/2 items-center justify-center whitespace-nowrap rounded-[6px] bg-surface-3 px-2.25 font-mono text-xs font-normal text-fg group-hover/hint:flex ${
          side === "left" ? "right-full mr-2.5" : "left-full ml-2.5"
        }`}
      >
        {hint}
      </span>
    </span>
  );
}
