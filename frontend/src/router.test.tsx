import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { act, screen, waitFor, fireEvent } from "@testing-library/react";
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { routeTree, router as appRouter } from "./router";
import { App } from "./App";
import { setAuthToken } from "./api/client";
import type { AuthValue } from "./auth/context";
import { DEFAULT_PREFS } from "./api/wire";
import { MAIN_SCROLL_SELECTOR, scrollRestorationOptions } from "./lib/scroll";
import { authValue, signedOut, testUser, renderWithApp, jsonResponse, stubFetch } from "./test/kit";

// The dashboard mounts ECharts cards that don't render in jsdom; for routing
// tests we only care that we *land* on it, so stub it to a sentinel.
vi.mock("./features/dashboard/Dashboard", () => ({
  Dashboard: () => <div>dashboard-page</div>,
}));

function renderAt(path: string, auth: AuthValue) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth },
    ...scrollRestorationOptions,
  });
  renderWithApp(<RouterProvider router={router} context={{ auth }} />, { auth: "provider" });
  return router;
}

// Pages load on demand. Load them all first, so a test waits on the router,
// not on the first import of a page (slow when the whole suite runs).
beforeAll(async () => {
  await Promise.all(
    Object.values(appRouter.routesById).map((route) =>
      (route.options.component as { preload?: () => Promise<void> } | undefined)?.preload?.(),
    ),
  );
});

const unauth = signedOut();

describe("route guard", () => {
  it("redirects an unauthenticated visit to a protected route to /login", async () => {
    const router = renderAt("/accounts", unauth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});

const authedUser = authValue();

describe("settings budget route", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse([]));
  });

  it("resolves /settings/budget for an ordinary authenticated user and renders the Categories heading", async () => {
    const router = renderAt("/settings/budget", authedUser);
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/budget"));
    expect(await screen.findByText("Categories")).toBeInTheDocument();
  });
});

describe("/transactions redirect", () => {
  it("redirects /transactions to /budget/transactions", async () => {
    const router = renderAt("/transactions", authedUser);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/budget/transactions"),
    );
  });
});

describe("public invite/reset routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders /invite for an unauthenticated visitor without redirecting to login", async () => {
    // Token guard fetch: return a valid invite so the page renders its form.
    stubFetch(async () => jsonResponse({ type: "invite", email: null }));
    renderAt("/invite/abc", unauth);
    expect(await screen.findByText("Create your account")).toBeInTheDocument();
  });
});

describe("login redirect", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthToken(null);
    vi.restoreAllMocks();
  });

  // Regression: a successful login must land on the dashboard, not bounce the
  // user back to /login because the route guard read a stale auth context.
  it("sends the user to the dashboard after a successful login", async () => {
    stubFetch(async (url: string) =>
        url.includes("/auth/login")
          ? jsonResponse({
                token: "t",
                user: { id: "u1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS, welcomeDone: true },
              })
          : new Response("{}", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }));

    renderWithApp(<App />, { auth: "provider" });

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "a@t.local" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("dashboard-page")).toBeInTheDocument();
  });
});

describe("scroll reset on navigation", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthToken(null);
    vi.restoreAllMocks();
    stubFetch(async () => jsonResponse([]));
  });

  // Regression: the app scrolls inside <main>, which belongs to the pathless
  // `app` route and so survives navigation. Without the router's scroll
  // restoration naming it, the previous page's scrollTop would carry over.
  it("scrolls the main container back to the top when navigating to a new page", async () => {
    const router = renderAt("/settings/budget", authedUser);
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/budget"));

    const main = document.querySelector(MAIN_SCROLL_SELECTOR);
    expect(main).not.toBeNull();
    const scrollTo = vi.spyOn(main as Element, "scrollTo");

    await act(async () => {
      await router.navigate({ to: "/" });
    });
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));

    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ top: 0, left: 0 });
  });
});

describe("welcome guard", () => {
  const newcomer = authValue({ user: testUser({ welcomeDone: false }) });

  beforeEach(() => {
    stubFetch(async () => jsonResponse([]));
  });

  it("sends a user who hasn't finished the welcome to /welcome", async () => {
    const router = renderAt("/accounts", newcomer);
    await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
  });

  it("hands the bank's raw query to the welcome screen", async () => {
    // The provider's query as the browser has it, which the guard forwards untouched.
    window.history.pushState({}, "", "/connections/callback?state=c42&code=1e3&connection_id=7");
    try {
      const router = renderAt("/connections/callback?state=c42&code=1e3&connection_id=7", newcomer);
      await waitFor(() => expect(router.state.location.pathname).toBe("/welcome"));
      const complete = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/connections/complete");
      await waitFor(() => expect(complete()).toHaveLength(1));
      expect(JSON.parse(complete()[0][1]!.body as string)).toEqual({
        connectionId: "c42",
        params: { code: "1e3", connection_id: "7" },
      });
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("renders the callback page without the sidebar for a finished user", async () => {
    const router = renderAt("/connections/callback?code=abc", authedUser);
    expect(await screen.findByText("Your bank couldn't be connected")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/connections/callback");
    expect(screen.queryByRole("link", { name: "Accounts" })).not.toBeInTheDocument();
  });

  it("sends a logged-out visitor of the callback to /login", async () => {
    const router = renderAt("/connections/callback?state=c1&code=abc", unauth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });

  it("sends a user who finished it away from /welcome", async () => {
    const router = renderAt("/welcome", authedUser);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("sends a logged-out visitor of /welcome to /login", async () => {
    const router = renderAt("/welcome", unauth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  });
});

describe("admin-only settings", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse([]));
  });

  it("sends a non-admin away from an admin page", async () => {
    const router = renderAt("/settings/users", authedUser);
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("lets an admin open it", async () => {
    const admin = authValue({ user: testUser({ role: "admin" }) });
    const router = renderAt("/settings/server", admin);
    await waitFor(() => expect(router.state.matches.at(-1)?.routeId).toBe("/signedIn/app/settings/server"));
    expect(router.state.location.pathname).toBe("/settings/server");
  });
});

describe("finishing the welcome screen", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    setAuthToken("t");
    vi.restoreAllMocks();
        stubFetch(async (url: string) => {
        // /auth/me and the prefill's prefs save both answer with the session user.
        if (url === "/api/auth/me" || url === "/api/auth/prefs")
          return jsonResponse({ id: "u1", name: "Ann", email: "a@t.local", role: "user", prefs: DEFAULT_PREFS, welcomeDone: false });
        if (url === "/api/auth/welcome") return new Response(null, { status: 204 });
        if (url === "/api/budget/categorize/status") return jsonResponse({ configured: false, running: false });
        return jsonResponse([]);
      });
  });

  // The whole chain: skip -> POST -> updateUser -> App invalidates -> guard leaves /welcome.
  it("leaves /welcome once the user skips the setup", async () => {
    renderWithApp(<App />, { auth: "provider" });

    const skip = await screen.findByRole("button", { name: "Skip setup for now" });
    expect(appRouter.state.location.pathname).toBe("/welcome");
    fireEvent.click(skip);
    await waitFor(() => expect(appRouter.state.location.pathname).toBe("/"));
    expect(await screen.findByText("dashboard-page")).toBeInTheDocument();
    expect(appRouter.state.location.pathname).not.toBe("/welcome");
  });
});
