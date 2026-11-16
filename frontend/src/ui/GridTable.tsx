import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { HEAD_ROW, gridColumns, type Track } from "./gridTable";
import { staleRowsClass } from "./stale";

type GridTableProps = {
  /** Below the sum of their minimums the table scrolls sideways. */
  tracks: Track[];
  head: ReactNode;
  children: ReactNode;
  busy?: boolean;
  /** Rows are out of date while their replacement loads (`staleClass`): they dim, the header doesn't. */
  stale?: boolean;
};

/** `display: contents` drops the groups' implicit ARIA roles, so every element here names its own. */
export function GridTable({ tracks, head, children, busy = false, stale = false }: GridTableProps) {
  const { template, minWidth } = gridColumns(tracks);
  return (
    <div className="overflow-x-auto">
      <table role="table" aria-busy={busy || undefined} className={`grid w-full text-sm ${staleRowsClass(stale)}`} style={{ gridTemplateColumns: template, minWidth }}>
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

export function SortHeader({ label, active, asc, right = false, onClick, testId }: {
  label: string;
  active: boolean;
  asc: boolean;
  right?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      // The browser's button style resets `text-transform`, so it is not inherited from the row.
      className={`inline-flex h-4 cursor-pointer items-center gap-1 align-middle uppercase transition-colors duration-140 ${
        right ? "flex-row-reverse" : ""
      } ${active ? "text-fg" : "text-fg-dim enabled:hover:text-fg"}`}
    >
      {label}
      {active && (asc ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />)}
    </button>
  );
}

export function TableEmpty({ icon, message, action, testId }: { icon: ReactNode; message: ReactNode; action?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className={`flex flex-col items-center py-16 text-fg-faint [&>svg]:size-6 ${action ? "gap-3" : "gap-2"}`}>
      {icon}
      <p className="text-sm">{message}</p>
      {action}
    </div>
  );
}
