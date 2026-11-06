import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import { RootLayout } from "./shell/RootLayout";
import { CrashPage } from "./shell/CrashPage";
import { Dashboard } from "./features/dashboard/Dashboard";
import { Accounts } from "./features/accounts/Accounts";
import { Investments } from "./features/investments/Investments";
import { Budget } from "./features/budget/Budget";
import { BudgetOverview } from "./features/budget/overview/Overview";
import { TransactionsMode } from "./features/budget/transactions/TransactionsMode";
import { ReviewMode } from "./features/budget/review/ReviewMode";
import { Login } from "./features/auth/Login";
import { SettingsLayout } from "./features/settings/SettingsLayout";
import { SettingsGeneral } from "./features/settings/general/General";
import { SettingsAccount } from "./features/settings/account/Account";
import { SettingsConnections } from "./features/connections/Connections";
import { SettingsBudget } from "./features/budget/settings/Budget";
import { SettingsUsers } from "./features/settings/users/Users";
import { SettingsServer } from "./features/settings/server/Server";
import { ConnectionCallback } from "./features/connections/ConnectionCallback";
import { Invite } from "./features/auth/Invite";
import { Reset } from "./features/auth/Reset";
import { Welcome } from "./features/welcome/Welcome";
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

// Pathless layout for every page that needs a session. A user who hasn't
// finished the welcome screen sees only it; the bank's return to the callback
// is handed to it, query and all, so the welcome screen finishes the connection.
const signedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "signedIn",
  beforeLoad: ({ context: { auth }, matches }) => {
    if (!auth.isAuthenticated) throw redirect({ to: "/login" });
    const entering = (route: { id: string }) => matches.some((m) => m.routeId === route.id);

    const welcomePending = auth.user?.welcomeDone === false;
    const onWelcome = entering(welcomeRoute);
    if (welcomePending && !onWelcome) {
      if (entering(connectionsCallbackRoute)) {
        // The provider's own query string, byte for byte: the router's parsed
        // search would retype values that look like numbers.
        const callback = window.location.search.replace(/^\?/, "");
        throw redirect({ to: "/welcome", search: { step: "bank", callback } });
      }
      throw redirect({ to: "/welcome" });
    }
    if (!welcomePending && onWelcome) throw redirect({ to: "/" });

    if (matches.some((m) => m.staticData.adminOnly) && auth.user?.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
});

// Pathless layout: the app chrome (sidebar + content).
const appRoute = createRoute({
  getParentRoute: () => signedInRoute,
  id: "app",
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

// Bookmarks of /transactions land on the budget's transactions page.
const transactionsRedirectRoute = createRoute({
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
  staticData: { adminOnly: true },
  component: SettingsUsers,
});

const settingsServerRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "server",
  staticData: { adminOnly: true },
  component: SettingsServer,
});

// Full page outside the app chrome.
const connectionsCallbackRoute = createRoute({
  getParentRoute: () => signedInRoute,
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

// Full page outside the app chrome, like login and invite.
const welcomeRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/welcome",
  validateSearch: (search: Record<string, unknown>): { step?: "bank"; callback?: string } => ({
    ...(search.step === "bank" ? { step: "bank" as const } : {}),
    ...(typeof search.callback === "string" ? { callback: search.callback } : {}),
  }),
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
  signedInRoute.addChildren([
    welcomeRoute,
    connectionsCallbackRoute,
    appRoute.addChildren([
      indexRoute,
      accountsRoute,
      investmentsRoute,
      budgetRoute.addChildren([budgetIndexRoute, budgetOverviewRoute, budgetTransactionsRoute, budgetReviewRoute]),
      transactionsRedirectRoute,
      settingsRouteWithChildren,
    ]),
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
  interface StaticDataRouteOption {
    /** Only admins may open the page; the settings nav hides it from others. */
    adminOnly?: boolean;
  }
}
