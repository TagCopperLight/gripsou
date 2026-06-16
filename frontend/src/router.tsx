import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { RootLayout } from "./components/RootLayout";
import { Dashboard } from "./pages/Dashboard";
import { Accounts } from "./pages/Accounts";
import { Transactions } from "./pages/Transactions";
import { Settings } from "./pages/Settings";

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
  component: Settings,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  accountsRoute,
  transactionsRoute,
  settingsRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
