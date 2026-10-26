import type { ReactNode } from "react";

import { HEAD_ROW } from "./gridTable";

type GridTableProps = {
  /** The column tracks, as a `grid-template-columns` value. */
  columns: string;
  /** The sum of the tracks' minimums: below it the table scrolls sideways
   *  rather than shrinking a column past its floor. */
  minWidth: string;
  /** The header cells (`HEAD_CELL`), in column order. */
  head: ReactNode;
  /** The rows (`ROW_CELLS`). */
  children: ReactNode;
};

/** A table on a CSS grid (see `gridTable.ts`). `display: contents` drops the
 *  groups out of the layout so the rows themselves are the grid's items, and
 *  with them their implicit ARIA roles, which is why every element here names
 *  its own. */
export function GridTable({ columns, minWidth, head, children }: GridTableProps) {
  return (
    <div className="overflow-x-auto">
      <table role="table" className="grid w-full text-sm" style={{ gridTemplateColumns: columns, minWidth }}>
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
