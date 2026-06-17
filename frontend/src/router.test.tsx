import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { routeTree } from "./router";
import { AuthProvider } from "./auth/AuthProvider";
import type { AuthValue } from "./auth/context";

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
  login: async () => {},
  logout: () => {},
};

describe("route guard", () => {
  it("redirects an unauthenticated visit to a protected route to /login", async () => {
    const router = renderAt("/accounts", unauth);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});
