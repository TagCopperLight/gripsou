import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Search } from "lucide-react";

import { Popover } from "../../ui/Popover";
import { HEAD_TEXT } from "../../ui/gridTable";

/** `label` is matched by the search and read by the keyboard; `render` draws the line. */
export type ChooserItem = {
  id: string;
  label: string;
  group?: string;
  render: ReactNode;
};

type ChooserBase = {
  title: string;
  items: ChooserItem[];
  groups?: { key: string; label: string }[];
  selectedIds: string[];
  onClose: () => void;
  anchor?: HTMLElement | null;
  /** A band below the list that stays put while the middle scrolls, for toggles pending until confirmed (bulk tag Save). */
  footer?: ReactNode;
};

/** `multi` checkmarks lines and stays open; `pick` applies one and closes. */
export type ChooserMode =
  | { mode: "multi"; onToggle: (id: string) => void }
  | {
      mode: "pick";
      onPick: (id: string | null) => void;
      noneLabel?: string;
    };

type EntityChooserProps = ChooserBase & ChooserMode;

export function EntityChooser(props: EntityChooserProps) {
  const { title, items, groups, mode, selectedIds, onClose, anchor, footer } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  // `active` is where Enter lands, 0 from the start so a bare Enter applies the first line. Nothing is painted
  // until `navigated` (arrow key or pointer), so no line looks hovered under a still cursor.
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  // Option ids for `aria-activedescendant`: focus stays in the field while the arrows move.
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (sequenceIndex: number) => `${baseId}-opt-${sequenceIndex}`;

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => (needle ? items.filter((i) => i.label.toLowerCase().includes(needle)) : items),
    [items, needle],
  );

  const apply = (id: string | null) => {
    if (props.mode === "pick") {
      props.onPick(id);
      onClose();
      return;
    }
    if (id !== null) props.onToggle(id);
  };

  // The "no category" line is a keyboard-reachable option at sequence index 0; visible items are offset by one.
  const noneLabel = props.mode === "pick" ? props.noneLabel : undefined;
  const hasNone = !!noneLabel && (!needle || noneLabel.toLowerCase().includes(needle));
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
        id={optionId(sequenceIndex)}
        tabIndex={-1}
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
    <Popover title={title} anchor={anchor} onClose={onClose} initialFocus={search}>
      <div className="flex flex-col">
        {/* The field carries no surface: its top edge is the panel's. */}
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-faint" />
          <input
            type="search"
            ref={search}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setNavigated(false);
            }}
            onKeyDown={onKeyDown}
            aria-label={t("budget.chooser.search")}
            aria-controls={listId}
            aria-activedescendant={lastIndex >= 0 ? optionId(Math.min(active, lastIndex)) : undefined}
            placeholder={t("budget.chooser.search")}
            className="w-full bg-transparent py-2.5 pl-9 pr-3 text-sm text-fg outline-none"
          />
        </label>
        <div className="h-px bg-surface-3" />
        <div
          id={listId}
          role="listbox"
          aria-label={title}
          aria-multiselectable={mode === "multi"}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setNavigated(false)}
          className="flex max-h-80 flex-col gap-0.5 overflow-y-auto p-2"
        >
          {hasNone && (
            <button
              type="button"
              role="option"
              id={optionId(0)}
              tabIndex={-1}
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
                      className={`px-2 pb-1 pt-2 ${HEAD_TEXT}`}
                    >
                      {g.label}
                    </p>
                    {rows.map((item) => line(item, visible.indexOf(item)))}
                  </div>
                );
              })
            : visible.map(line)}
          {visible.length === 0 && !hasNone && (
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
