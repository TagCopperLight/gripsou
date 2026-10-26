// The screens of the inventory (docs/ui-review.md), in review order.

export type Screen = { path: string; label: string };

export const SCREENS: Screen[] = [
  { path: "/", label: "Dashboard" },
  { path: "/accounts", label: "Accounts" },
  { path: "/investments", label: "Investments" },
  { path: "/budget/overview", label: "Budget · Overview" },
  { path: "/budget/transactions", label: "Budget · Transactions" },
  { path: "/budget/review", label: "Budget · Review" },
  { path: "/settings/general", label: "Settings · General" },
  { path: "/settings/account", label: "Settings · Account" },
  { path: "/settings/connections", label: "Settings · Connections" },
  { path: "/settings/budget", label: "Settings · Budget" },
  { path: "/settings/users", label: "Settings · Users" },
  { path: "/settings/server", label: "Settings · Server" },
  { path: "/login", label: "Login" },
  { path: "/invite/mock-token", label: "Invite" },
  { path: "/reset/mock-token", label: "Reset password" },
  { path: "/welcome", label: "Welcome" },
  { path: "/connections/callback", label: "Connection callback" },
];
