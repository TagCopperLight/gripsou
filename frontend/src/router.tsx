import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { RootLayout } from "./components/RootLayout";
import { CrashPage } from "./components/CrashPage";
import { Dashboard } from "./pages/Dashboard";
import { Accounts } from "./pages/Accounts";
import { Investments } from "./pages/Investments";
import { Budget } from "./pages/Budget";
import { BudgetOverview } from "./pages/budget/Overview";
import { TransactionsMode } from "./pages/budget/TransactionsMode";
import { ReviewMode } from "./pages/budget/ReviewMode";
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
import { Welcome } from "./pages/Welcome";
import type { AuthValue } from "./auth/context";
import { scrollRestorationOptions } from "./lib/scroll";

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
    // A new account goes through the welcome screen first.
    if (context.auth.user?.welcomeDone === false) {
      throw redirect({ to: "/welcome" });
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

const investmentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/investments",
  component: Investments,
});

const budgetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/budget",
  component: Budget,
});

// Overview is the landing mode: the analysis is what the page is for, and the
// Transactions list is where you go to act on what it shows.
const budgetIndexRoute = createRoute({
  getParentRoute: () => budgetRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/budget/overview" });
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

const budgetReviewRoute = createRoute({
  getParentRoute: () => budgetRoute,
  path: "review",
  component: ReviewMode,
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

// Full page outside the app chrome. Not guarded by the welcome redirect: mid-
// setup the page hands the callback over to /welcome itself.
const connectionsCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/connections/callback",
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) throw redirect({ to: "/login" });
  },
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

// Full page outside the app chrome, like login and invite.
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  validateSearch: (search: Record<string, unknown>): { step?: "bank"; callback?: string } => ({
    ...(search.step === "bank" ? { step: "bank" as const } : {}),
    ...(typeof search.callback === "string" ? { callback: search.callback } : {}),
  }),
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) throw redirect({ to: "/login" });
    if (context.auth.user?.welcomeDone !== false) throw redirect({ to: "/" });
  },
  component: Welcome,
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
  welcomeRoute,
  connectionsCallbackRoute,
  appRoute.addChildren([
    indexRoute,
    accountsRoute,
    investmentsRoute,
    budgetRoute.addChildren([budgetIndexRoute, budgetOverviewRoute, budgetTransactionsRoute, budgetReviewRoute]),
    legacyTransactionsRoute,
    settingsRouteWithChildren,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { auth: undefined! },
  // A page that throws while showing: ours, not the library's page with the
  // code's error in it.
  defaultErrorComponent: CrashPage,
  ...scrollRestorationOptions,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
