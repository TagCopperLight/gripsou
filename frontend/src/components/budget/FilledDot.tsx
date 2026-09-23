import type { SVGProps } from "react";

/** Fallback icon for a category without one: a solid dot in `currentColor`.
 *  Lucide's `Dot` is too small to read and `CircleSmall` a touch too big, so
 *  the radius is tuned here (≈6px across in a 14px box). */
export function FilledDot(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="5.1" />
    </svg>
  );
}
