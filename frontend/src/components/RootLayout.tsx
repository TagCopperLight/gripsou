import { Outlet } from "@tanstack/react-router";
import { Sidebar } from "./Sidebar";

export function RootLayout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto pr-4 pt-4">
        <Outlet />
      </main>
    </div>
  );
}
