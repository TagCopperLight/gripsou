import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import userEvent from "@testing-library/user-event";

import { AccountsList } from "./AccountsList";
import type { Account } from "../api/types";
import { AuthContext, type AuthValue } from "../auth/context";
import { DEFAULT_PREFS } from "../lib/prefs";

function account(id: string, connectionId: string, value: string): Account {
  return {
    id, connectionId, name: `Account ${id}`, color: "#5b9bf0", typeKey: "checking", value, currency: "EUR",
    valueNative: null, lastSyncAt: null, sourceName: `Bank ${connectionId}`, sourceLogo: null, fxMissing: false,
  };
}

function renderList(accounts: Account[], privateMode = false) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) =>
    new Response(String(url).includes("/holdings") ? "[]" : JSON.stringify(accounts), { status: 200, headers: { "Content-Type": "application/json" } }),
  ));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { prefs: { ...DEFAULT_PREFS, privateMode } } as unknown as AuthValue;
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}><AccountsList /></AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe("AccountsList", () => {
  it("shows nothing while the user has no accounts", async () => {
    const { container } = renderList([]);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText("All accounts")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("in private mode, masks every amount, and the summary's one eye reveals them all", async () => {
    renderList([account("a", "c1", "1200"), account("b", "c2", "300")], true);
    await screen.findByText("All accounts");
    expect(screen.queryByText(/\d[\s\u202f]?\d{3}[,.]00/)).not.toBeInTheDocument();
    expect(screen.queryByText(/300[,.]00/)).not.toBeInTheDocument();
    // Shares stay: they say nothing about the amounts.
    expect(screen.getAllByText(/80\s?%/).length).toBeGreaterThan(0);

    const eyes = screen.getAllByRole("button", { name: /show amount/i });
    expect(eyes).toHaveLength(1);
    await userEvent.click(eyes[0]);
    expect(screen.getAllByText(/1[\s\u202f]?500[,.]00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/300[,.]00/).length).toBeGreaterThan(0);
  });
});
