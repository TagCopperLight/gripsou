import type { SVGProps } from "react";

/** Lucide's `Dot` is too small and `CircleSmall` a touch too big; this radius gives ≈6px in a 14px box. */
export function FilledDot(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="5.1" />
    </svg>
  );
}
