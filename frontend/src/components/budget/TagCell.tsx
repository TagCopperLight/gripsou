import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";

import { TagChip } from "./TagChip";
import type { BudgetTag } from "../../api/budget";

type TagCellProps = {
  tags: Pick<BudgetTag, "id" | "name" | "color">[];
  onOpen: (anchor: HTMLElement) => void;
};

/** `gap-1`, in px — the loop below has to add the gaps itself. */
const GAP = 4;

/** The tags cell keeps everything on one line: as many chips as fit, then a
 *  `+N` counter for the rest, then the add button.
 *
 *  Widths cannot come from the rendered row — hiding a chip changes the very
 *  layout the decision was made from, which oscillates. So an invisible
 *  measuring copy of the full line (every chip, the counter, the button) is
 *  laid out off-flow, and the visible line is rendered from its numbers.
 *  In jsdom every width is 0, so everything "fits" and the counter never
 *  appears — which is what the row tests expect.
 */
export function TagCell({ tags, onOpen }: TagCellProps) {
  const { t } = useTranslation();
  const line = useRef<HTMLSpanElement>(null);
  const ghost = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(tags.length);

  const measure = useCallback(() => {
    const box = line.current;
    const probe = ghost.current;
    if (!box || !probe) return;
    const items = Array.from(probe.children) as HTMLElement[];
    // The measuring line holds one node per tag, then the counter, then the
    // button — the last two are the reserved width, not candidates.
    const counter = items[items.length - 2];
    const button = items[items.length - 1];
    const widths = items.slice(0, -2).map((el) => el.offsetWidth);
    const avail = box.clientWidth - button.offsetWidth - GAP;

    let used = 0;
    let fits = 0;
    for (let i = 0; i < widths.length; i++) {
      const next = used + (i > 0 ? GAP : 0) + widths[i];
      const rest = widths.length - i - 1;
      if (next + (rest > 0 ? GAP + counter.offsetWidth : 0) > avail) break;
      used = next;
      fits = i + 1;
    }
    // A single chip truncates rather than disappearing: "+3" alone says
    // nothing about what is on the row.
    setVisible(Math.max(widths.length === 0 ? 0 : 1, fits));
  }, []);

  useLayoutEffect(() => {
    measure();
    const box = line.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [measure, tags]);

  const hidden = tags.slice(visible);
  const addButton = (
    <button
      type="button"
      data-testid="tx-add-tag"
      onClick={(e) => onOpen(e.currentTarget)}
      aria-label={t("budget.transactions.addTags")}
      /* Always mounted (for non-lot rows) and focusable — opacity, not
         `display`, drives visibility so a keyboard-only user can Tab to it and
         reveal it with its own focus, not just row hover. */
      className="shrink-0 cursor-pointer rounded-md p-1 text-fg-faint opacity-0 transition-opacity hover:text-fg group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
    >
      <Plus className="size-3.5" />
    </button>
  );

  return (
    <span ref={line} className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {tags.slice(0, visible).map((tag) => (
        <TagChip key={tag.id} tag={tag} className="min-w-0 shrink" />
      ))}
      {hidden.length > 0 && (
        <span
          data-testid="tx-tags-overflow"
          title={hidden.map((tag) => tag.name).join(", ")}
          className="shrink-0 text-[11px] font-medium text-fg-faint"
        >
          +{hidden.length}
        </span>
      )}
      {addButton}

      {/* Off-flow twin: full-width, never wrapping, invisible and inert. */}
      <span
        ref={ghost}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 flex items-center gap-1 opacity-0"
      >
        {tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} className="shrink-0" />
        ))}
        <span className="shrink-0 text-[11px] font-medium">+{tags.length}</span>
        {/* A stand-in, not the button itself: a second `tx-add-tag` would be
            both a duplicate test id and a focusable node inside aria-hidden. */}
        <span className="shrink-0 p-1">
          <Plus className="size-3.5" />
        </span>
      </span>
    </span>
  );
}
