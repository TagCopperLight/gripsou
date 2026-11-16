import { Fragment } from "react";
import { Outlet, Link, Navigate, useMatchRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AdminBadge, SettingsSidebar } from "./SettingsSidebar";
import { useSettingsNav } from "./settingsNav";
import { LogoutButton } from "./LogoutButton";
import { Surface } from "../../ui/Surface";
import { usePhone } from "../../ui/usePhone";

export function SettingsLayout() {
  const { t } = useTranslation();
  const items = useSettingsNav();
  const matchRoute = useMatchRoute();
  const current = items.find((item) => matchRoute({ to: item.to }));

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* A phone shows the section list on its own page (`SettingsHome`), and each section under a way back to it. */}
      {current && (
        <div className="pb-3 md:hidden">
          <Link
            to="/settings"
            className="-ml-1.5 inline-flex items-center gap-0.5 py-1 pr-2 text-sm font-medium text-fg-dim"
          >
            <ChevronLeft className="size-4.5" strokeWidth={2} />
            {t("nav.settings")}
          </Link>
          <h1 className="text-2xl font-bold text-fg">{t(current.labelKey)}</h1>
        </div>
      )}

      {/* Stays in view while the page scrolls, where it starts (under the main area's top padding). */}
      <div className="hidden md:sticky md:top-6 md:block md:self-start">
        <SettingsSidebar />
      </div>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}

/** Phones only: a wider screen goes straight to the first section (the index route redirects). */
export function SettingsHome() {
  const { t } = useTranslation();
  const phone = usePhone();
  const items = useSettingsNav();
  const firstAdminIndex = items.findIndex((item) => item.adminOnly);

  if (!phone) return <Navigate to="/settings/general" replace />;
  return (
    <div className="flex flex-col gap-4 pb-8">
      <h1 className="text-2xl font-bold text-fg">{t("nav.settings")}</h1>
      <Surface className="flex flex-col p-1.5">
        {items.map(({ to, labelKey, icon: Icon, adminOnly }, index) => (
          <Fragment key={to}>
            {adminOnly && index === firstAdminIndex && (
              <div className="mx-3 my-1.5 border-t border-surface-2" />
            )}
            <Link to={to} className="flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium text-fg active:bg-hover">
              <Icon className="size-5 text-fg-dim" strokeWidth={2} />
              <span>{t(labelKey)}</span>
              {adminOnly && <AdminBadge />}
              <ChevronRight className="ml-auto size-4.5 text-fg-faint" strokeWidth={2} />
            </Link>
          </Fragment>
        ))}
      </Surface>
      <Surface className="p-1.5">
        <LogoutButton />
      </Surface>
    </div>
  );
}
