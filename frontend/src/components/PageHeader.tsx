import type { ReactNode } from "react";

type PageHeaderProps = {
  title: string;
  /** Controls shown on the title's line, at its right (Budget's mode switch). */
  children?: ReactNode;
};

// Page title, shared by the Dashboard, Accounts, Investments and Budget pages.
// It sits centred in the band above the first surface: `main`'s 24px above,
// then the 32px line, then this `pb-2` plus the page's 16px gap below = 24px.
// The line is held at 32px so a taller control beside the title doesn't push
// it off-centre; SyncButton (`top-6`, 32px) is placed on the same line.
export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap md:h-10 content-center items-center justify-between gap-3 pb-2">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </div>
  );
}
