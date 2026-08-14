import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";
import { SyncButton } from "./SyncButton";

export function RootLayout() {
  return (
    <div className="flex flex-col-reverse h-screen md:flex-row">
      <Sidebar />
      <main className="flex-1 relative overflow-auto pr-4 pt-4">
        <Outlet />
        <SyncButton />
      </main>
    </div>
  );
}
