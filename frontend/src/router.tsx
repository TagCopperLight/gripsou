import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { RootLayout } from "./components/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { Accounts } from "./pages/Accounts";
import { Transactions } from "./pages/Transactions";
import { Login } from "./pages/Login";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsGeneral } from "./pages/settings/General";
import { SettingsAccount } from "./pages/settings/Account";
import { SettingsUsers } from "./pages/settings/Users";
import { SettingsServer } from "./pages/settings/Server";
import type { AuthValue } from "./auth/context";

type RouterContext = { auth: AuthValue };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  beforeLoad: ({ context }) => {
    // Already signed in (e.g. just logged in, or revisiting /login): the guard
    // re-runs when auth changes (App invalidates the router) and bounces to the
    // dashboard, so the redirect doesn't depend on imperative navigation.
    if (context.auth.isAuthenticated) {
      throw redirect({ to: "/" });
    }
  },
  component: Login,
});

// Pathless layout: everything under it requires auth and renders inside the
// app chrome (sidebar + content).
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: Dashboard,
});

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/accounts",
  component: Accounts,
});

const transactionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/transactions",
  component: Transactions,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
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

export const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    accountsRoute,
    transactionsRoute,
    settingsRouteWithChildren,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { auth: undefined! },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
