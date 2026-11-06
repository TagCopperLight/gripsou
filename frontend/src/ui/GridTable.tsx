import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { HEAD_ROW, gridColumns, type Track } from "./gridTable";

type GridTableProps = {
  /** The column tracks, in column order. Below the sum of their minimums the
   *  table scrolls sideways rather than shrinking a column past its floor. */
  tracks: Track[];
  /** The header cells (`HEAD_CELL`), in column order. */
  head: ReactNode;
  /** The rows (`ROW_CELLS`). */
  children: ReactNode;
};

/** A table on a CSS grid (see `gridTable.ts`). `display: contents` drops the
 *  groups out of the layout so the rows themselves are the grid's items, and
 *  with them their implicit ARIA roles, which is why every element here names
 *  its own. */
export function GridTable({ tracks, head, children }: GridTableProps) {
  const { template, minWidth } = gridColumns(tracks);
  return (
    <div className="overflow-x-auto">
      <table role="table" className="grid w-full text-sm" style={{ gridTemplateColumns: template, minWidth }}>
        <thead role="rowgroup" className="contents">
          <tr role="row" className={HEAD_ROW}>
            {head}
          </tr>
        </thead>
        <tbody role="rowgroup" className="contents">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** A column title that sorts the table: lit, with the direction's chevron,
 *  while it is the sort key. */
export function SortHeader({ label, active, asc, right = false, onClick, testId }: {
  label: string;
  active: boolean;
  asc: boolean;
  /** A right-aligned column: the chevron goes before the title. */
  right?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      // `uppercase` on the button itself: the browser's own button style
      // resets `text-transform`, so it is not inherited from the row.
      className={`inline-flex h-4 cursor-pointer items-center gap-1 align-middle uppercase transition-colors duration-140 ${
        right ? "flex-row-reverse" : ""
      } ${active ? "text-fg" : "text-fg-dim hover:text-fg"}`}
    >
      {label}
      {active && (asc ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />)}
    </button>
  );
}

/** What a table shows instead of its rows when it has none: a faint icon, a
 *  line, and an action (clear the filters) when there is one. */
export function TableEmpty({ icon, message, action, testId }: { icon: ReactNode; message: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className={`flex flex-col items-center py-16 text-fg-faint [&>svg]:size-6 ${action ? "gap-3" : "gap-2"}`}>
      {icon}
      <p className="text-sm">{message}</p>
      {action}
    </div>
  );
}
