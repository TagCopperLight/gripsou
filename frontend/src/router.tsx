import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { RootLayout } from "./components/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { Accounts } from "./pages/Accounts";
import { Transactions } from "./pages/Transactions";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsGeneral } from "./pages/settings/General";
import { SettingsAccount } from "./pages/settings/Account";
import { SettingsUsers } from "./pages/settings/Users";
import { SettingsServer } from "./pages/settings/Server";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Dashboard,
});

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/accounts",
  component: Accounts,
});

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/transactions",
  component: Transactions,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsLayout,
});

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/general" });
  },
});

const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "general",
  component: SettingsGeneral,
});

const settingsAccountRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "account",
  component: SettingsAccount,
});

const settingsUsersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "users",
  component: SettingsUsers,
});

const settingsServerRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "server",
  component: SettingsServer,
});

const settingsRouteWithChildren = settingsRoute.addChildren([
  settingsIndexRoute,
  settingsGeneralRoute,
  settingsAccountRoute,
  settingsUsersRoute,
  settingsServerRoute,
]);

const routeTree = rootRoute.addChildren([
  indexRoute,
  accountsRoute,
  transactionsRoute,
  settingsRouteWithChildren,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
