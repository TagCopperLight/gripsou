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
  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg data-[status=active]:bg-surface-2 data-[status=active]:text-fg data-[status=active]:font-bold";

export function Sidebar() {
  const { t } = useTranslation();
  const { user: self } = useAuth();
  const roleLabel = self
    ? t(self.role === "admin" ? "sidebar.administrator" : "settings.roleMember")
    : "";

  return (
    <aside className="flex h-full w-72 flex-col gap-6 bg-bg p-4">
      <div className="flex justify-center py-4 font-wordmark text-2xl font-semibold tracking-tight text-fg">
        gripsou
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map(({ to, labelKey, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={navLinkClassName}
          >
            <Icon className="size-4.5" strokeWidth={2} />
            <span>{t(labelKey)}</span>
          </Link>
        ))}
      </nav>

      <Link to="/settings" className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover">
        <Avatar name={self?.name ?? "?"} src={self?.prefs.avatar} className="size-8 my-0.5" />
        <div className="flex flex-col justify-between h-8">
          <span className="text-[13px] font-semibold text-fg leading-none">{self?.name ?? ""}</span>
          <span className="text-xs text-fg-faint font-normal leading-none">{roleLabel}</span>
        </div>
      </Link>
    </aside>
  );
}
