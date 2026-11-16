import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { boneWidths } from "./boneWidths";

/** The part of a screen whose data is still on its way, drawn as grey
 *  `Bone`s in the shape of what will replace it, so nothing moves when it
 *  arrives. Only the unknown data is a skeleton: titles, controls and every
 *  other part of the frame render as usual around it. */
export function Skeleton({ className = "", children }: { className?: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-busy
      aria-label={t("common.loading")}
      data-testid="skeleton"
      className={`motion-safe:animate-pulse ${className}`}
    >
      {children}
    </div>
  );
}

/** One grey block of a `Skeleton`: an icon, a chip, a button, an input.
 *  `className` gives its size and, when not the default rounding, its shape
 *  (the `bone` class sits in a lower layer, so `rounded-full` wins over it). */
export function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={`bone block ${className}`} style={style} />;
}

/** One line of text still loading: a line box of the text's own size (`text`,
 *  e.g. "text-sm"), with a bone as tall as its letters, so the line that
 *  replaces it is exactly as high. `className` or `style` give the width. */
export function TextBone({ text, className = "", style }: { text: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={`flex h-lh items-center ${text}`}>
      <Bone className={`h-[0.7em] ${className}`} style={style} />
    </span>
  );
}

/** A chart still loading: one block as tall as the chart, which `className`
 *  (e.g. "mt-4 h-80") or `style` sets. */
export function ChartBone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <Skeleton className={className}>
      <Bone className="h-full w-full rounded-xl" style={style} />
    </Skeleton>
  );
}

/** The rows of a table still loading, under its real header. A `Skeleton`
 *  (a `div`) cannot sit between a table's rows, so each row pulses itself and
 *  is hidden from assistive tech; the caller marks the table `aria-busy`.
 *  `rows` is the list's usual length; `children` draws a row's cells from its
 *  text width. */
export function BoneRows({ rows, className = "", children }: {
  rows: number;
  className?: string;
  children: (width: number) => ReactNode;
}) {
  return boneWidths(rows).map((w, i) => (
    <tr key={i} role="row" aria-hidden data-testid="skeleton-row" className={`motion-safe:animate-pulse ${className}`}>
      {children(w)}
    </tr>
  ));
}
