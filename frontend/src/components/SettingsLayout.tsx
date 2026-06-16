import { Outlet } from "@tanstack/react-router";
import { SettingsSidebar } from "./SettingsSidebar";

export function SettingsLayout() {
  return (
    <div className="flex h-full">
      <SettingsSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
