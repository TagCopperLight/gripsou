import { beforeEach, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";
import { setAuthToken } from "../api/client";
import * as client from "../api/client";

function Probe() {
  const { isAuthenticated, isBootstrapping } = useAuth();
  return <div>{isBootstrapping ? "boot" : isAuthenticated ? "in" : "out"}</div>;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  setAuthToken(null);
  vi.restoreAllMocks();
});

test("no token → unauthenticated, no /auth/me call", async () => {
  const spy = vi.spyOn(client, "getJson");
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());
  expect(spy).not.toHaveBeenCalled();
});

test("stored token → /auth/me resolves → authenticated", async () => {
  setAuthToken("tok", true);
  vi.spyOn(client, "getJson").mockResolvedValue({
    id: "1", name: "Ann", email: "a@t.local", role: "admin",
  });
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("in")).toBeInTheDocument());
});

test("stored token → /auth/me returns 401 → unauthenticated, global handler NOT called", async () => {
  setAuthToken("expired-tok", true);

  // Register a global unauthorized handler spy — it must NOT be called.
  const unauthorizedSpy = vi.fn();
  client.setUnauthorizedHandler(unauthorizedSpy);

  // Simulate the real fetch path: getJson with skipGlobalUnauthorized = true
  // means the 401 should never reach the global handler.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unauthorized", { status: 401 })),
  );

  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(screen.getByText("out")).toBeInTheDocument());

  // Global handler must not have been triggered (no spurious POST /auth/logout).
  expect(unauthorizedSpy).not.toHaveBeenCalled();
});
