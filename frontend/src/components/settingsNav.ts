import {
  SlidersHorizontal,
  User,
  Users,
  Server,
  type LucideIcon,
} from "lucide-react";

export type SettingsNavItem = {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  adminOnly: boolean;
};

export const settingsNavItems: SettingsNavItem[] = [
  { to: "/settings/general", labelKey: "settings.general", icon: SlidersHorizontal, adminOnly: false },
  { to: "/settings/account", labelKey: "settings.account", icon: User, adminOnly: false },
  { to: "/settings/users", labelKey: "settings.users", icon: Users, adminOnly: true },
  { to: "/settings/server", labelKey: "settings.server", icon: Server, adminOnly: true },
];
