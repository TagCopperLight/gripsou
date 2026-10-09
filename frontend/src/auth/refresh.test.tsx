import { afterEach, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryObserver } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import { useAuth } from "./context";
import * as api from "../api/client";
import { queryClient } from "../queryClient";
import { keys } from "../api/keys";
import { DEFAULT_PREFS, setPrefs } from "../lib/prefs";
import type { SessionUser } from "../api/types";

const user: SessionUser = { id: "a", name: "Ann", email: "ann@example.test", role: "admin", prefs: DEFAULT_PREFS };
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

afterEach(() => {
  queryClient.clear();
  api.setAuthToken(null);
  setPrefs(DEFAULT_PREFS);
  vi.restoreAllMocks();
});

async function authenticated() {
  api.setAuthToken("old-token");
  vi.spyOn(api, "getJson").mockResolvedValue(user);
  const hook = renderHook(() => useAuth(), { wrapper });
  await waitFor(() => expect(hook.result.current.user?.id).toBe("a"));
  return hook;
}

it("refetches server-converted amounts after changing reporting currency", async () => {
  const { result, unmount } = await authenticated();
  let amount = "100 EUR";
  const observer = new QueryObserver(queryClient, { queryKey: keys.netWorth("1y"), queryFn: async () => amount });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await waitFor(() => expect(observer.getCurrentResult().data).toBe("100 EUR"));
    vi.spyOn(api, "patchJson").mockImplementation(async () => {
      amount = "110 USD";
      return { ...user, prefs: { ...DEFAULT_PREFS, currency: "USD" } };
    });
    await act(() => result.current.updatePrefs({ ...DEFAULT_PREFS, currency: "USD" }));
    await waitFor(() => expect(observer.getCurrentResult().data).toBe("110 USD"));
  } finally { unsubscribe(); unmount(); }
});

it("checks AI status when opting in starts an automatic run", async () => {
  const { result, unmount } = await authenticated();
  try {
    queryClient.setQueryData(keys.budgetAiStatus(), { running: false });
    vi.spyOn(api, "patchJson").mockResolvedValue({ ...user, prefs: { ...DEFAULT_PREFS, budgetAiEnabled: true } });
    await act(() => result.current.updatePrefs({ ...DEFAULT_PREFS, budgetAiEnabled: true }));
    expect(queryClient.getQueryState(keys.budgetAiStatus())?.isInvalidated).toBe(true);
  } finally { unmount(); }
});

it("keeps server data cached for a formatting-only preference change", async () => {
  const { result, unmount } = await authenticated();
  try {
    queryClient.setQueryData(keys.netWorth("1y"), []);
    vi.spyOn(api, "patchJson").mockResolvedValue({ ...user, prefs: { ...DEFAULT_PREFS, numberDecimals: 0 } });
    await act(() => result.current.updatePrefs({ ...DEFAULT_PREFS, numberDecimals: 0 }));
    expect(queryClient.getQueryState(keys.netWorth("1y"))?.isInvalidated).toBe(false);
  } finally { unmount(); }
});

it.each(["login", "adoptSession", "logout"] as const)("clears the previous session's cached data on %s", async (action) => {
  const { result, unmount } = await authenticated();
  try {
    queryClient.setQueryData(keys.transactions({}), { pages: [[{ id: "old-user-row" }]], pageParams: [0] });
    vi.spyOn(api, "postJson").mockResolvedValue({ token: "new-token", user: { ...user, id: "b" } });
    await act(async () => {
      if (action === "login") await result.current.login("bob@example.test", "password", false);
      else if (action === "adoptSession") result.current.adoptSession("new-token", { ...user, id: "b" });
      else await result.current.logout();
    });
    expect(queryClient.getQueryData(keys.transactions({}))).toBeUndefined();
  } finally { unmount(); }
});

it.each(["success", "failure"] as const)("ignores an old preference request's %s after switching sessions", async (outcome) => {
  const { result, unmount } = await authenticated();
  let resolve!: (user: SessionUser) => void;
  let reject!: (error: Error) => void;
  let started = false;
  vi.spyOn(api, "patchJson").mockImplementation(() => {
    started = true;
    return new Promise<SessionUser>((yes, no) => { resolve = yes; reject = no; });
  });
  try {
    let pending!: Promise<void>;
    act(() => { pending = result.current.updatePrefs({ ...DEFAULT_PREFS, numberDecimals: 0 }).catch(() => {}); });
    await waitFor(() => expect(started).toBe(true));
    act(() => result.current.adoptSession("new-token", { ...user, id: "b" }));
    await act(async () => {
      if (outcome === "success") resolve({ ...user, prefs: { ...DEFAULT_PREFS, numberDecimals: 0 } });
      else reject(new Error("request failed"));
      await pending;
    });
    expect(result.current.user?.id).toBe("b");
    expect(result.current.prefs.numberDecimals).toBe(DEFAULT_PREFS.numberDecimals);
  } finally { unmount(); }
});

it("ignores a previous user's delayed profile response", async () => {
  const { result, unmount } = await authenticated();
  try {
    act(() => result.current.adoptSession("new-token", { ...user, id: "b" }));
    act(() => result.current.updateUser({ ...user, name: "old user's edited name" }));
    expect(result.current.user?.id).toBe("b");
  } finally { unmount(); }
});

it("preserves a newer profile edit when an older preference acknowledgement arrives", async () => {
  const { result, unmount } = await authenticated();
  let release!: (user: SessionUser) => void;
  let started = false;
  vi.spyOn(api, "patchJson").mockImplementation(() => {
    started = true;
    return new Promise<SessionUser>((resolve) => { release = resolve; });
  });
  try {
    let pending!: Promise<void>;
    act(() => { pending = result.current.updatePrefs({ ...DEFAULT_PREFS, numberDecimals: 0 }); });
    await waitFor(() => expect(started).toBe(true));
    act(() => result.current.updateUser({ ...user, name: "New name", email: "new@example.test" }));
    await act(async () => {
      release({ ...user, prefs: { ...DEFAULT_PREFS, numberDecimals: 0 } });
      await pending;
    });
    expect(result.current.user?.name).toBe("New name");
    expect(result.current.user?.email).toBe("new@example.test");
    expect(result.current.prefs.numberDecimals).toBe(0);
  } finally { unmount(); }
});

it("serializes preference autosaves and keeps the latest optimistic choices visible", async () => {
  const { result, unmount } = await authenticated();
  let release!: () => void;
  const first = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  let serverCurrency = "EUR";
  vi.spyOn(api, "patchJson").mockImplementation(async (_path, prefs) => {
    requests++;
    if (requests === 1) await first;
    serverCurrency = (prefs as typeof DEFAULT_PREFS).currency;
    return { ...user, prefs };
  });
  try {
    let usd!: Promise<void>;
    let gbp!: Promise<void>;
    act(() => { usd = result.current.updatePrefs({ ...DEFAULT_PREFS, currency: "USD" }); });
    await waitFor(() => expect(requests).toBe(1));
    act(() => { gbp = result.current.updatePrefs({ ...DEFAULT_PREFS, currency: "GBP" }); });
    expect(result.current.prefs.currency).toBe("GBP");
    expect(requests).toBe(1);
    await act(async () => { release(); await usd; await gbp; });
    expect(serverCurrency).toBe("GBP");
    expect(result.current.prefs.currency).toBe("GBP");
  } finally { release(); unmount(); }
});

it("does not hold the next preference save behind a slow data refresh", async () => {
  const { result, unmount } = await authenticated();
  let currency = "EUR";
  let release!: (data: string) => void;
  const slow = new Promise<string>((resolve) => { release = resolve; });
  const observer = new QueryObserver(queryClient, {
    queryKey: keys.netWorth("1y"),
    queryFn: async () => currency === "USD" ? slow : currency,
  });
  const unsubscribe = observer.subscribe(() => {});
  let requests = 0;
  vi.spyOn(api, "patchJson").mockImplementation(async (_path, prefs) => {
    requests++;
    currency = (prefs as typeof DEFAULT_PREFS).currency;
    return { ...user, prefs };
  });
  let usd: Promise<void> | undefined;
  let gbp: Promise<void> | undefined;
  try {
    await waitFor(() => expect(observer.getCurrentResult().data).toBe("EUR"));
    act(() => { usd = result.current.updatePrefs({ ...DEFAULT_PREFS, currency: "USD" }); });
    await waitFor(() => expect(observer.getCurrentResult().isFetching).toBe(true));
    act(() => { gbp = result.current.updatePrefs({ ...DEFAULT_PREFS, currency: "GBP" }); });
    await waitFor(() => expect(requests).toBe(2));
    await waitFor(() => expect(observer.getCurrentResult().data).toBe("GBP"));
  } finally {
    release("USD");
    await act(async () => { await usd; await gbp; });
    unsubscribe(); unmount();
  }
});
