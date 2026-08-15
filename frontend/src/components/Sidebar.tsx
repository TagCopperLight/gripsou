import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "./Avatar";
import { useAuth } from "../auth/context";

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/accounts", labelKey: "nav.accounts", icon: Wallet },
  { to: "/transactions", labelKey: "nav.transactions", icon: ArrowLeftRight },
];

const navLinkClassName =
  "flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg data-[status=active]:text-green data-[status=active]:font-bold md:justify-start md:data-[status=active]:bg-surface-2 md:data-[status=active]:text-fg";

export function Sidebar() {
  const { t } = useTranslation();
  const { user: self } = useAuth();
  const roleLabel = self
    ? t(self.role === "admin" ? "sidebar.administrator" : "settings.roleMember")
    : "";

  return (
    <aside className="flex w-full flex-row gap-6 bg-surface px-4 py-2 md:bg-bg md:p-4 md:h-full md:w-72 md:flex-col">
      <div className="hidden justify-center py-4 font-wordmark text-2xl font-semibold tracking-tight text-fg md:flex">
        gripsou
      </div>

      <nav className="flex flex-1 flex-row justify-around gap-1 md:flex-col md:justify-start">
        {navItems.map(({ to, labelKey, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={navLinkClassName}
          >
            <Icon className="size-5.5 md:size-4.5" strokeWidth={2} />
            <span className="hidden md:inline">{t(labelKey)}</span>
          </Link>
        ))}
      </nav>

      <Link to="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover md:mt-auto">
        <Avatar name={self?.name ?? "?"} src={self?.prefs.avatar} className="size-8 my-0.5" />
        <div className="hidden flex-col justify-between h-8 md:flex">
          <span className="text-[13px] font-semibold text-fg leading-none">{self?.name ?? ""}</span>
          <span className="text-xs text-fg-faint font-normal leading-none">{roleLabel}</span>
        </div>
      </Link>
    </aside>
  );
}
