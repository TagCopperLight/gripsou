import {
  SlidersHorizontal,
  User,
  Link2,
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
  { to: "/settings/general",     labelKey: "settings.general.title",     icon: SlidersHorizontal, adminOnly: false },
  { to: "/settings/account",     labelKey: "settings.account.title",     icon: User,              adminOnly: false },
  { to: "/settings/connections", labelKey: "settings.connections.title", icon: Link2,             adminOnly: false },
  { to: "/settings/users",       labelKey: "settings.users.title",       icon: Users,             adminOnly: true  },
  { to: "/settings/server",      labelKey: "settings.server.title",      icon: Server,            adminOnly: true  },
];
