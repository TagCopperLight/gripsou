import { Outlet, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SettingsSidebar } from "./SettingsSidebar";
import { settingsNavItems } from "./settingsNav";
import { LogoutButton } from "./LogoutButton";
import { useAuth } from "../auth/context";

// Phone: the sidebar becomes a scrollable tab row above the page.
const tabClassName =
  "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-fg-dim transition-colors data-[status=active]:bg-surface-2 data-[status=active]:text-fg data-[status=active]:font-semibold";

export function SettingsLayout() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const items = settingsNavItems.filter((item) => isAdmin || !item.adminOnly);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="md:hidden">
        <h1 className="pb-3 text-2xl font-bold text-fg">{t("nav.settings")}</h1>
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-4">
          {items.map(({ to, labelKey, icon: Icon }) => (
            <Link key={to} to={to} className={tabClassName}>
              <Icon className="size-4" strokeWidth={2} />
              <span className="whitespace-nowrap">{t(labelKey)}</span>
            </Link>
          ))}
          <div className="shrink-0">
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <SettingsSidebar />
      </div>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
