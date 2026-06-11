import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Wallet,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";

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

export function Sidebar() {
  const { t } = useTranslation();

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
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg data-[status=active]:bg-surface-2 data-[status=active]:text-fg data-[status=active]:font-bold"
          >
            <Icon className="size-4.5" strokeWidth={2} />
            <span>{t(labelKey)}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
