import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { settingsNavItems } from "./settingsNav";
import { LogoutButton } from "./LogoutButton";
import { useAuth } from "../auth/context";

const navLinkClassName =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg data-[status=active]:bg-surface-2 data-[status=active]:text-fg data-[status=active]:font-bold";

export function SettingsSidebar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const items = settingsNavItems.filter((item) => isAdmin || !item.adminOnly);
  const firstAdminIndex = items.findIndex((item) => item.adminOnly);

  return (
    <nav className="flex h-full w-56 flex-col gap-1 pr-4">
      <div className="px-3 pb-4 text-2xl font-bold text-fg">{t("nav.settings")}</div>
      {items.map(({ to, labelKey, icon: Icon, adminOnly }, index) => (
        <Fragment key={to}>
          {adminOnly && index === firstAdminIndex && (
            <div className="my-1 border-t border-surface-2" />
          )}
          <Link to={to} className={navLinkClassName}>
            <Icon className="size-4.5" strokeWidth={2} />
            <span>{t(labelKey)}</span>
            {adminOnly && (
              <span className="ml-auto rounded border border-surface-3 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                {t("settings.adminBadge")}
              </span>
            )}
          </Link>
        </Fragment>
      ))}
      <div className="py-1 border-t border-surface-2">
        <LogoutButton />
      </div>
    </nav>
  );
}
