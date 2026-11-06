import { StrictMode, type ReactElement, type ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, type Mock } from "vitest";
import { AuthContext, type AuthValue } from "../auth/context";
import { AuthProvider } from "../auth/AuthProvider";
import { DEFAULT_PREFS, type UserPrefs } from "../api/wire";
import type { SessionUser } from "../api/wire";

export function testUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    name: "Ann",
    email: "a@t.local",
    role: "user",
    prefs: DEFAULT_PREFS,
    welcomeDone: true,
    ...overrides,
  };
}

/** A signed-in user's auth context; every action is a `vi.fn()` that resolves. */
export function authValue(overrides: Partial<AuthValue> = {}): AuthValue {
  const prefs = overrides.prefs ?? DEFAULT_PREFS;
  return {
    isAuthenticated: true,
    user: testUser({ prefs }),
    isBootstrapping: false,
    prefs,
    login: vi.fn(async () => null),
    loginWithPasskey: vi.fn(async () => {}),
    verifyLogin: vi.fn(async () => {}),
    adoptSession: vi.fn(),
    logout: vi.fn(async () => {}),
    updateUser: vi.fn(),
    updatePrefs: vi.fn(async () => {}),
    ...overrides,
  };
}

export function signedOut(overrides: Partial<AuthValue> = {}): AuthValue {
  return authValue({ isAuthenticated: false, user: null, ...overrides });
}

/** A client that reports a failure at once instead of retrying it. */
export function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

export type AppOptions = {
  client?: QueryClient;
  /** The auth context: a fixed value, `"provider"` for the app's own
   *  AuthProvider (signs in from the stored token), or `null` for none.
   *  Defaults to `authValue({ prefs })`. */
  auth?: AuthValue | "provider" | null;
  /** Shorthand for a signed-in user with these prefs. */
  prefs?: UserPrefs;
  strict?: boolean;
};

/** The providers the app wraps every page in, as a `wrapper` for
 *  `render`/`renderHook`. */
export function appWrapper({ client = testQueryClient(), auth, prefs, strict = false }: AppOptions = {}) {
  const value = auth === undefined ? authValue(prefs ? { prefs } : {}) : auth;
  function Wrapper({ children }: { children: ReactNode }) {
    const withAuth =
      value === "provider" ? <AuthProvider>{children}</AuthProvider>
      : value ? <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
      : children;
    const tree = <QueryClientProvider client={client}>{withAuth}</QueryClientProvider>;
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  }
  return { wrapper: Wrapper, client, auth: value };
}

export function renderWithApp(ui: ReactElement, options: AppOptions = {}) {
  const { wrapper, client, auth } = appWrapper(options);
  return Object.assign(render(ui, { wrapper }), { client, auth });
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Replace `fetch` with `handler` (default: 204 to everything) and return the mock. */
export function stubFetch(handler: FetchHandler = () => new Response(null, { status: 204 })): Mock<FetchHandler> {
  const mock = vi.fn<FetchHandler>(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** The requests `fetchMock` sent to a URL containing `path`, oldest first. */
export function requestsTo(fetchMock: Mock<FetchHandler>, path: string): { method: string; body: unknown }[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes(path))
    .map(([, init]) => ({
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    }));
}
