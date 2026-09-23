import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ReviewMode } from "./ReviewMode";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS } from "../../lib/prefs";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const base = {
  t: Date.UTC(2026, 8, 1), type: "withdrawal", amount: "-12.00", amountReporting: "-12.00",
  currency: "EUR", accountId: "a1", accountName: "Checking", accountColor: "#5b9bf0",
  source: "cash", ticker: null, quantity: null, unitPrice: null, fee: null,
  categoryDefaultKey: null, categoryIcon: null, categorySource: "ai",
  needsReview: true, checked: false, isTransfer: false, isOrphanTransfer: false, tags: [],
};
const GUESS = { ...base, id: "t1", description: "LECLERC 0999", categoryId: "c1", categoryName: "Groceries",
  categoryColor: "#34d399", categoryKind: "expense", categoryConfidence: "0.42" };
const NO_GUESS = { ...base, id: "t2", description: "VIR 123", categoryId: null, categoryName: null,
  categoryColor: null, categoryKind: null, categoryConfidence: null };

type Server = { pending: unknown[]; calls: { url: string; body: unknown }[] };

function stubServer(server: Server) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") {
      server.calls.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null });
      if (u.includes("/accept")) server.pending = server.pending.filter((t) => !u.includes(`/${(t as { id: string }).id}/`));
      return new Response(null, { status: 204 });
    }
    if (u.includes("/budget/categorize/status")) {
      return Response.json({ configured: true, enabled: true, running: false, remaining: 0,
        reviewCount: server.pending.length, threshold: 80, lastRun: null });
    }
    if (u.includes("/budget/categories")) return Response.json([]);
    return Response.json(server.pending);
  }));
}

function renderMode() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { prefs: DEFAULT_PREFS, updatePrefs: vi.fn() } as unknown as AuthValue;
  return render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={auth}>
        <ReviewMode />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Review mode", () => {
  it("lists pending guesses with their confidence and the threshold", async () => {
    stubServer({ pending: [GUESS, NO_GUESS], calls: [] });
    renderMode();
    expect(await screen.findByText("LECLERC 0999")).toBeVisible();
    expect(screen.getByText("42%")).toBeVisible();
    expect(screen.getByText("below 80% confidence")).toBeVisible();
    expect(screen.getByText("0 / 2 resolved")).toBeVisible();
  });

  it("offers only Correct on a no-guess line", async () => {
    stubServer({ pending: [NO_GUESS], calls: [] });
    renderMode();
    const line = await screen.findByTestId("review-line-t2");
    expect(within(line).queryByRole("button", { name: "Accept" })).toBeNull();
    expect(within(line).getByRole("button", { name: "Correct" })).toBeVisible();
  });

  it("accepting keeps the line in place as resolved, and Undo restores the guess", async () => {
    const server: Server = { pending: [GUESS, NO_GUESS], calls: [] };
    stubServer(server);
    renderMode();
    const line = await screen.findByTestId("review-line-t1");
    fireEvent.click(within(line).getByRole("button", { name: "Accept" }));
    const resolved = await screen.findByTestId("resolved-line-t1");
    expect(resolved).toHaveTextContent("kept Groceries");
    expect(screen.getByText("1 / 2 resolved")).toBeVisible();

    fireEvent.click(within(resolved).getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(server.calls.at(-1)).toEqual({
        url: expect.stringContaining("/budget/review/t1/undo"),
        body: { categoryId: "c1", confidence: "0.42" },
      }),
    );
  });

  it("clear resolved removes the lines and shrinks the total", async () => {
    stubServer({ pending: [GUESS, NO_GUESS], calls: [] });
    renderMode();
    fireEvent.click(within(await screen.findByTestId("review-line-t1")).getByRole("button", { name: "Accept" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear resolved" }));
    await waitFor(() => expect(screen.queryByTestId("resolved-line-t1")).toBeNull());
    expect(screen.getByText("0 / 1 resolved")).toBeVisible();
  });

  it("shows the success state when the queue drains", async () => {
    stubServer({ pending: [], calls: [] });
    renderMode();
    expect(await screen.findByText("All caught up")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to Overview" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/overview" });
  });
});
