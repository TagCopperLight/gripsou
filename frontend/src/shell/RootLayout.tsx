import type { ReactNode } from "react";
import { Outlet } from "@tanstack/react-router";
import { Sidebar, SidebarSkeleton } from "./Sidebar";
import { SyncButton } from "../features/connections/SyncButton";
import { MAIN_SCROLL_ID } from "../lib/scroll";
import { useAuth } from "../auth/context";

export function RootLayout() {
  // The sidebar names the user, so it waits for the session.
  const { user } = useAuth();
  return (
    <Shell sidebar={user ? <Sidebar /> : <SidebarSkeleton />}>
      <Outlet />
      <SyncButton />
    </Shell>
  );
}

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
