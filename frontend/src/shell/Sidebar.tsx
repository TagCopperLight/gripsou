import { Fragment, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ChartColumn,
  LayoutDashboard,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "../ui/Avatar";
import { Bone, Skeleton, TextBone } from "../ui/Skeleton";
import { useAuth } from "../auth/context";
import { useHealth } from "../api/health";
import { BudgetIcon } from "../features/budget/budgetIcons";

type NavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/accounts", labelKey: "nav.accounts", icon: Wallet },
  { to: "/investments", labelKey: "nav.investments", icon: ChartColumn },
  { to: "/budget", labelKey: "nav.budget", icon: BudgetIcon },
];

/** On a phone each link is an equal-width tab of the bottom bar. */
const PHONE_TAB = "max-md:min-w-0 max-md:flex-1 max-md:justify-center max-md:px-0 max-md:py-2.5";

const navLinkClassName =
  `flex items-center justify-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg data-[status=active]:text-green md:justify-start md:data-[status=active]:font-bold md:data-[status=active]:bg-surface-2 md:data-[status=active]:text-fg ${PHONE_TAB}`;

const profileClassName =
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-fg-dim transition-colors hover:bg-hover data-[status=active]:text-green md:mt-auto md:data-[status=active]:text-fg-dim ${PHONE_TAB}`;

type DrawLink = (to: string, className: string, children: ReactNode) => ReactNode;

export function Sidebar() {
  const { t } = useTranslation();
  const { user: self } = useAuth();
  const roleLabel = self
    ? t(self.role === "admin" ? "roles.admin" : "roles.member")
    : "";

  return (
    <SidebarFrame
      link={(to, className, children) => (
        <Link to={to} activeOptions={{ exact: to === "/" }} className={className}>
          {children}
        </Link>
      )}
      profile={
        <>
          <Avatar name={self?.name ?? "?"} src={self?.prefs.avatar} className="size-8 my-0.5 max-md:size-7 max-md:my-0 rounded-full max-md:in-data-[status=active]:ring-2 max-md:in-data-[status=active]:ring-green" />
          <div className="hidden flex-col justify-between h-8 md:flex">
            <span className="text-[13px] font-semibold text-fg leading-none">{self?.name ?? ""}</span>
            <span className="text-xs text-fg-faint font-normal leading-none">{roleLabel}</span>
          </div>
        </>
      }
    />
  );
}

export function SidebarSkeleton() {
  return (
    <SidebarFrame
      link={(_to, className, children) => <span className={className}>{children}</span>}
      profile={
        <Skeleton className="flex items-center gap-3">
          <Bone className="size-8 my-0.5 rounded-full max-md:size-7 max-md:my-0" />
          <div className="hidden flex-col justify-between h-8 md:flex">
            <TextBone text="text-[13px] leading-none" className="w-24" />
            <TextBone text="text-xs leading-none" className="w-14" />
          </div>
        </Skeleton>
      }
    />
  );
}

function SidebarFrame({ link, profile }: { link: DrawLink; profile: ReactNode }) {
  const { t } = useTranslation();
  const health = useHealth();
  const version = health.data?.version;

  return (
    <aside className="flex w-full flex-row gap-6 bg-surface px-4 py-2 md:bg-bg md:p-4 md:h-full md:w-72 md:flex-col max-md:gap-0 max-md:border-t max-md:border-surface-2 max-md:px-1 max-md:pt-1 max-md:pb-[max(0.25rem,calc(env(safe-area-inset-bottom)-0.75rem))]">
      <div className="hidden justify-center py-4 font-wordmark text-2xl font-semibold tracking-tight text-fg md:flex">
        gripsou
      </div>

      <nav className="flex flex-1 flex-row justify-around gap-1 md:flex-col md:justify-start max-md:contents">
        {navItems.map(({ to, labelKey, icon: Icon }) => (
          <Fragment key={to}>
            {link(
              to,
              navLinkClassName,
              <>
                <Icon className="size-5.5 shrink-0 md:size-4.5" strokeWidth={2} />
                <span className="hidden md:inline">{t(labelKey)}</span>
              </>,
            )}
          </Fragment>
        ))}
      </nav>

      {link("/settings", profileClassName, profile)}

      {health.isPending ? (
        <Skeleton className="hidden px-3 md:-mt-4 md:block">
          <TextBone text="text-[11px]" className="w-10" />
        </Skeleton>
      ) : (
        version && <span className="hidden px-3 text-[11px] text-fg-faint md:-mt-4 md:block">{version}</span>
      )}
    </aside>
  );
}
