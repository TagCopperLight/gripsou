import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { Bone, TextBone } from "../../../ui/Skeleton";
import { HEAD_TEXT } from "../../../ui/gridTable";
import { withAlpha } from "../../../lib/color";

/** The rows' hover fill reaches past the card's text edge by their padding, so tiles and heading line up with the card's title. */
export function List({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="-mx-2">
      {label && <h3 className={`flex h-8 items-center px-2 uppercase ${HEAD_TEXT}`}>{label}</h3>}
      <div role="list" className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

/** `extra` sits over the row's end, before the chevron, for controls of its own (the reorder arrows). */
export function ListRow({ label, tile, title, subtitle, dimmed = false, extra, onOpen }: {
  label: string;
  tile: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  dimmed?: boolean;
  extra?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <div role="listitem" className="group relative">
      <button
        type="button"
        aria-label={label}
        onClick={onOpen}
        className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-left transition-colors duration-140 hover:bg-hover"
      >
        <span className={`flex min-w-0 flex-1 items-center gap-3 ${dimmed ? "opacity-70 [&>:first-child]:grayscale" : ""}`}>
          {tile}
          <span className="flex w-48 shrink-0 items-center gap-2 text-sm font-medium text-fg">{title}</span>
          <span
            className={`min-w-0 flex-1 truncate text-xs text-fg-faint ${
              extra ? "group-hover:pr-18 group-focus-within:pr-18" : ""
            }`}
          >
            {subtitle}
          </span>
        </span>
        <ChevronRight aria-hidden className={`size-4 shrink-0 text-fg-faint ${dimmed ? "opacity-70" : ""}`} />
      </button>
      {extra && <div className="absolute inset-y-0 right-10 flex items-center">{extra}</div>}
    </div>
  );
}

export function ListTile({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-lg"
      style={{ backgroundColor: withAlpha(color, 0.2), color }}
    >
      {children}
    </span>
  );
}

export function ListRowBone({ width }: { width: number }) {
  return (
    <div className="flex h-11 items-center gap-3 px-2">
      <Bone className="size-8 shrink-0 rounded-lg" />
      <span className="w-48 shrink-0">
        <TextBone text="text-sm" style={{ width: width * 1.6 }} />
      </span>
      <span className="min-w-0 flex-1">
        <TextBone text="text-xs" style={{ width: `${Math.min(80, width / 1.5)}%` }} />
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-faint opacity-40" />
    </div>
  );
}

export function ListHeadingBone() {
  return (
    <div className="-mx-2 flex h-8 items-center px-2">
      <Bone className="h-2.5 w-20" />
    </div>
  );
}

export function ListBadge({ icon, title, testId, children }: { icon: ReactNode; title?: string; testId?: string; children: ReactNode }) {
  return (
    <span
      data-testid={testId}
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-surface-3 px-1.5 py-0.5 text-[11px] font-medium text-fg-faint [&>svg]:size-3"
    >
      {icon}
      {children}
    </span>
  );
}
