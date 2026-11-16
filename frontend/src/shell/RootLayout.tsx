import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";
import { Sidebar, SidebarSkeleton } from "./Sidebar";
import { SyncButton } from "../features/connections/SyncButton";
import { MAIN_SCROLL_ID } from "../lib/scroll";

export function RootLayout() {
  return (
    <Shell sidebar={<Sidebar />}>
      <Outlet />
      <SyncButton />
    </Shell>
  );
}

/** The app's frame while a stored session is checked: nearly always, the
 *  app opens next. The page is left empty, as which one it is depends on
 *  the session (the welcome screen, a redirect). */
export function ShellSkeleton() {
  return <Shell sidebar={<SidebarSkeleton />} />;
}

function Shell({ sidebar, children }: { sidebar: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col-reverse h-dvh md:flex-row">
      {sidebar}
      <main
        data-scroll-restoration-id={MAIN_SCROLL_ID}
        className="flex-1 relative overflow-auto px-4 pt-6 md:pl-0"
      >
        {children}
      </main>
    </div>
  );
}
