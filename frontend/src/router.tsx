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
import { Setup } from "./features/setup/Setup";
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
    // Auth changes re-run the guard, so the redirect needs no imperative navigation.
    if (context.auth.isAuthenticated) {
      throw redirect({ to: "/" });
    }
  },
  component: Login,
});

// Pathless layout for pages that need a session. The bank's return to the callback goes to the welcome screen, query and all.
const signedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "signedIn",
  beforeLoad: ({ context: { auth }, matches }) => {
    // Pages needing nothing of the user are drawn while a saved session is checked.
    if (auth.isBootstrapping) return;
    if (!auth.isAuthenticated) throw redirect({ to: "/login" });
    const entering = (route: { id: string }) => matches.some((m) => m.routeId === route.id);

    const welcomePending = auth.user?.welcomeDone === false;
    const onWelcome = entering(welcomeRoute);
    if (welcomePending && !onWelcome) {
      if (entering(connectionsCallbackRoute)) {
        // Byte for byte: the router's parsed search would retype numeric-looking values.
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

const appRoute = createRoute({
  getParentRoute: () => signedInRoute,
  id: "app",
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  staticData: { beforeSession: true },
  component: Dashboard,
});

const accountsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/accounts",
  staticData: { beforeSession: true },
  component: Accounts,
});

const investmentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/investments",
  staticData: { beforeSession: true },
  component: Investments,
});

const budgetRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/budget",
  component: Budget,
});

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
  staticData: { beforeSession: true },
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
  staticData: { beforeSession: true },
  component: ReviewMode,
});

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

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  beforeLoad: ({ context }) => {
    if (context.auth.isAuthenticated) throw redirect({ to: "/" });
  },
  component: Setup,
});

const resetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset/$token",
  component: Reset,
});

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
  setupRoute,
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
  defaultErrorComponent: CrashPage,
  ...scrollRestorationOptions,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
  interface StaticDataRouteOption {
    adminOnly?: boolean;
    /** Drawn while a saved session is checked, so the page must read nothing of the user. */
    beforeSession?: boolean;
  }
}
