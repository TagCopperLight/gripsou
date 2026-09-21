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
import { Budget } from "./pages/Budget";
import { BudgetOverview } from "./pages/budget/Overview";
import { TransactionsMode } from "./pages/budget/TransactionsMode";
import { Login } from "./pages/Login";
import { SettingsLayout } from "./components/SettingsLayout";
import { SettingsGeneral } from "./pages/settings/General";
import { SettingsAccount } from "./pages/settings/Account";
import { SettingsConnections } from "./pages/settings/Connections";
import { SettingsBudget } from "./pages/settings/Budget";
import { SettingsUsers } from "./pages/settings/Users";
import { SettingsServer } from "./pages/settings/Server";
import { ConnectionCallback } from "./pages/ConnectionCallback";
import { Invite } from "./pages/Invite";
import { Reset } from "./pages/Reset";
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

const budgetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/budget",
  component: Budget,
});

// Phase 3 lands on Transactions, the only mode with something in it. Phase 4
// flips this to /budget/overview once the analysis exists.
const budgetIndexRoute = createRoute({
  getParentRoute: () => budgetRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/budget/transactions" });
  },
});

const budgetOverviewRoute = createRoute({
  getParentRoute: () => budgetRoute,
  path: "overview",
  component: BudgetOverview,
});

const budgetTransactionsRoute = createRoute({
  getParentRoute: () => budgetRoute,
  path: "transactions",
  component: TransactionsMode,
});

// The page moved; bookmarks and old links must not 404.
const legacyTransactionsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/transactions",
  beforeLoad: () => {
    throw redirect({ to: "/budget/transactions" });
  },
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

const settingsConnectionsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "connections",
  component: SettingsConnections,
});

const settingsBudgetRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "budget",
  component: SettingsBudget,
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

const connectionsCallbackRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/connections/callback",
  component: ConnectionCallback,
});

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$token",
  component: Invite,
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset/$token",
  component: Reset,
});

const settingsRouteWithChildren = settingsRoute.addChildren([
  settingsIndexRoute,
  settingsGeneralRoute,
  settingsAccountRoute,
  settingsConnectionsRoute,
  settingsBudgetRoute,
  settingsUsersRoute,
  settingsServerRoute,
]);

export const routeTree = rootRoute.addChildren([
  loginRoute,
  inviteRoute,
  resetRoute,
  appRoute.addChildren([
    indexRoute,
    accountsRoute,
    budgetRoute.addChildren([budgetIndexRoute, budgetOverviewRoute, budgetTransactionsRoute]),
    legacyTransactionsRoute,
    settingsRouteWithChildren,
    connectionsCallbackRoute,
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
