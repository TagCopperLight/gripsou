import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { routeTree } from "./router";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthProvider";
import { setAuthToken } from "./api/client";
import type { AuthValue } from "./auth/context";
import { DEFAULT_PREFS } from "./lib/prefs";

// The dashboard mounts ECharts cards that don't render in jsdom; for routing
// tests we only care that we *land* on it, so stub it to a sentinel.
vi.mock("./pages/Dashboard", () => ({
  Dashboard: () => <div>dashboard-page</div>,
}));

function renderAt(path: string, auth: AuthValue) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { auth },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <RouterProvider router={router} context={{ auth }} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

const unauth: AuthValue = {
  isAuthenticated: false,
  user: null,
  isBootstrapping: false,
  prefs: DEFAULT_PREFS,
  login: async () => {},
  logout: async () => {},
  updateUser: () => {},
  updatePrefs: async () => {},
};

describe("route guard", () => {
  it("redirects an unauthenticated visit to a protected route to /login", async () => {
    const router = renderAt("/accounts", unauth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/auth/login")
          ? new Response(
              JSON.stringify({
                token: "t",
                user: { id: "u1", name: "Ann", email: "a@t.local", role: "admin", prefs: DEFAULT_PREFS },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            )
          : new Response("{}", {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
      ),
    );

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText("Email"), {
      target: { value: "a@t.local" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("dashboard-page")).toBeInTheDocument();
  });
});
