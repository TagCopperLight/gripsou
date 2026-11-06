import {
  SlidersHorizontal,
  User,
  Link2,
  Users,
  Server,
  type LucideIcon,
} from "lucide-react";
import { useRouter, type RegisteredRouter } from "@tanstack/react-router";

import { BudgetIcon } from "../budget/budgetIcons";
import { useAuth } from "../../auth/context";

type SettingsPath = Exclude<Extract<keyof RegisteredRouter["routesByPath"], `/settings/${string}`>, "/settings/">;

type SettingsNavItem = {
  to: SettingsPath;
  labelKey: string;
  icon: LucideIcon;
};

const settingsNavItems: SettingsNavItem[] = [
  { to: "/settings/general",     labelKey: "settings.general.title",     icon: SlidersHorizontal },
  { to: "/settings/account",     labelKey: "settings.account.title",     icon: User },
  { to: "/settings/connections", labelKey: "settings.connections.title", icon: Link2 },
  { to: "/settings/budget",      labelKey: "settings.budget.title",      icon: BudgetIcon },
  { to: "/settings/users",       labelKey: "settings.users.title",       icon: Users },
  { to: "/settings/server",      labelKey: "settings.server.title",      icon: Server },
];

/** The settings pages the signed-in user may open. Which ones are admin-only
 *  is the route's own `adminOnly`, the flag the router guards them with. */
export function useSettingsNav(): (SettingsNavItem & { adminOnly: boolean })[] {
  const { routesByPath } = useRouter();
  const isAdmin = useAuth().user?.role === "admin";
  return settingsNavItems
    .map((item) => ({ ...item, adminOnly: routesByPath[item.to].options.staticData?.adminOnly === true }))
    .filter((item) => isAdmin || !item.adminOnly);
}
