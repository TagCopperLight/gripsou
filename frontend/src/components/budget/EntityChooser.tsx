import { useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Search } from "lucide-react";

import { Popover } from "./Popover";
import type { ChooserItem } from "../../lib/budget";

type EntityChooserProps = {
  title: string;
  items: ChooserItem[];
  /** Group keys in display order; omit for a flat list. */
  groups?: { key: string; label: string }[];
  /** `multi` checkmarks lines and stays open; `pick` applies and closes. */
  mode: "multi" | "pick";
  selectedIds: string[];
  onToggle?: (id: string) => void;
  onPick?: (id: string | null) => void;
  onClose: () => void;
  /** `pick` only: the label of the line that clears the value. */
  noneLabel?: string;
  /** The control that opened the chooser — the panel hangs under it. */
  anchor?: HTMLElement | null;
  /** An optional band below the list, mirroring the search header: it stays
   *  put while the middle scrolls. Used by callers whose toggles are pending
   *  until confirmed (the bulk tag chooser and its Save button). */
  footer?: ReactNode;
};

export function EntityChooser({
  title, items, groups, mode, selectedIds, onToggle, onPick, onClose, noneLabel, anchor, footer,
}: EntityChooserProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  // `active` is where Enter would land — it is 0 from the start so a bare
  // Enter applies the first line. `navigated` is whether the user has *aimed*
  // at anything yet (an arrow key, or the pointer over a line): until then
  // nothing is painted, so no line looks hovered under a motionless cursor.
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items;
  }, [items, query]);

  const apply = (id: string | null) => {
    if (mode === "pick") {
      onPick?.(id);
      onClose();
      return;
    }
    if (id !== null) onToggle?.(id);
  };

  // The "no category" line (pick mode only) is a real, keyboard-reachable
  // option, not a mouse-only extra: it occupies sequence index 0 and every
  // visible item is offset by one behind it.
  const hasNone = mode === "pick" && !!noneLabel;
  const offset = hasNone ? 1 : 0;
  const lastIndex = visible.length - 1 + offset;

  const applyAt = (index: number) => {
    if (hasNone && index === 0) {
      apply(null);
      return;
    }
    const item = visible[index - offset];
    if (item) apply(item.id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setNavigated(true);
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return Math.max(0, Math.min(lastIndex, next));
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      applyAt(active);
    }
  };

  const line = (item: ChooserItem, index: number) => {
    const sequenceIndex = index + offset;
    return (
      <button
        key={item.id}
        type="button"
        role="option"
        aria-selected={selectedIds.includes(item.id)}
        data-testid={`chooser-option-${item.id}`}
        onClick={() => apply(item.id)}
        onMouseEnter={() => {
          setNavigated(true);
          setActive(sequenceIndex);
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left cursor-pointer ${
          navigated && sequenceIndex === active ? "bg-hover" : ""
        }`}
      >
        {item.render}
        {mode === "multi" && selectedIds.includes(item.id) && (
          <Check data-testid="chooser-check" className="size-4 shrink-0 text-green" />
        )}
      </button>
    );
  };

  return (
    <Popover title={title} anchor={anchor} onClose={onClose}>
      <div className="flex flex-col">
        {/* Set into the top of the panel rather than floating on it: the field
         *  carries no surface of its own, its top edge *is* the panel's, and
         *  the rule under it is its only boundary. */}
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-faint" />
          <input
            type="search"
            data-autofocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setNavigated(false);
            }}
            onKeyDown={onKeyDown}
            placeholder={t("budget.chooser.search")}
            className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm text-fg outline-none"
          />
        </label>
        <div className="h-px bg-surface-3" />
        <div
          ref={listRef}
          role="listbox"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setNavigated(false)}
          className="flex max-h-80 flex-col gap-0.5 overflow-y-auto p-2"
        >
          {hasNone && (
            <button
              type="button"
              role="option"
              aria-selected={selectedIds.length === 0}
              data-testid="chooser-option-none"
              onClick={() => apply(null)}
              onMouseEnter={() => {
                setNavigated(true);
                setActive(0);
              }}
              className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-sm text-fg-dim cursor-pointer ${
                navigated && active === 0 ? "bg-hover" : "hover:bg-hover"
              }`}
            >
              {noneLabel}
            </button>
          )}
          {groups
            ? groups.map((g) => {
                const rows = visible.filter((i) => i.group === g.key);
                if (rows.length === 0) return null;
                return (
                  <div key={g.key} className="flex flex-col gap-0.5">
                    <p
                      data-testid="chooser-group"
                      className="px-2 pb-1 pt-2 font-mono text-[11px] font-medium tracking-wide text-fg-faint"
                    >
                      {g.label}
                    </p>
                    {rows.map((item) => line(item, visible.indexOf(item)))}
                  </div>
                );
              })
            : visible.map(line)}
          {visible.length === 0 && (
            <p className="px-2 py-4 text-sm text-fg-faint">{t("budget.chooser.noMatch")}</p>
          )}
        </div>
        {footer && (
          <>
            <div className="h-px bg-surface-3" />
            <div data-testid="chooser-footer" className="flex justify-end p-2">
              {footer}
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}
