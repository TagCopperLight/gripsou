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

const TWIN = { ...GUESS, id: "t3", description: "LECLERC 1234", categoryConfidence: "0.51" };

type Server = {
  pending: unknown[];
  calls: { url: string; body: unknown }[];
  /** What accept reports as other rows sharing the description. */
  same?: number;
  /** Rows apply-to-description writes; `breaks` makes the first call refuse. */
  applied?: string[];
  breaks?: number;
};

function stubServer(server: Server) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (init?.method === "POST") {
      server.calls.push({ url: u, body: init.body ? JSON.parse(String(init.body)) : null });
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (u.includes("/accept")) {
        server.pending = server.pending.filter((t) => !u.includes(`/${(t as { id: string }).id}/`));
        return Response.json({ sameDescriptionCount: server.same ?? 0 });
      }
      if (u.includes("/apply-to-description")) {
        if (server.breaks && !body.confirmBreakPairs) {
          return Response.json({ updated: 0, pendingPairBreaks: server.breaks });
        }
        const ids = server.applied ?? [];
        server.pending = server.pending.filter((t) => !ids.includes((t as { id: string }).id));
        return Response.json({ updated: ids.length, ids });
      }
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
    expect(screen.getByTestId("review-progress")).toHaveTextContent("0 / 2 resolved");
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
    expect(screen.getByTestId("review-progress")).toHaveTextContent("1 / 2 resolved");

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
    expect(screen.getByTestId("review-progress")).toHaveTextContent("0 / 1 resolved");
  });

  it("shows the success state when the queue drains", async () => {
    stubServer({ pending: [], calls: [] });
    renderMode();
    expect(await screen.findByText("All caught up")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Back to Overview" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/overview" });
  });

  it("offers no apply-to-others when nothing else shares the name", async () => {
    stubServer({ pending: [GUESS, NO_GUESS], calls: [], same: 0 });
    renderMode();
    fireEvent.click(within(await screen.findByTestId("review-line-t1")).getByRole("button", { name: "Accept" }));
    const resolved = await screen.findByTestId("resolved-line-t1");
    await waitFor(() => expect(screen.getByTestId("review-progress")).toHaveTextContent("1 / 2 resolved"));
    expect(within(resolved).queryByRole("button", { name: /Apply to/ })).toBeNull();
  });

  it("applying to others resolves the queued twin in place", async () => {
    const server: Server = { pending: [GUESS, TWIN, NO_GUESS], calls: [], same: 2, applied: ["t1", "t3", "t9"] };
    stubServer(server);
    renderMode();
    fireEvent.click(within(await screen.findByTestId("review-line-t1")).getByRole("button", { name: "Accept" }));
    const resolved = await screen.findByTestId("resolved-line-t1");
    fireEvent.click(await within(resolved).findByRole("button", { name: "Apply to 2 others" }));

    expect(await within(resolved).findByText("applied to 2 others")).toBeVisible();
    expect(server.calls.at(-1)).toEqual({
      url: expect.stringContaining("/transactions/t1/apply-to-description"),
      body: { categoryId: "c1" },
    });
    expect(await screen.findByTestId("resolved-line-t3")).toHaveTextContent("set to Groceries, same name");
    expect(screen.getByTestId("review-progress")).toHaveTextContent("2 / 3 resolved");
  });

  it("asks before an apply-to-others that would break a transfer pair", async () => {
    const server: Server = { pending: [GUESS, TWIN], calls: [], same: 1, applied: ["t1", "t3"], breaks: 1 };
    stubServer(server);
    renderMode();
    fireEvent.click(within(await screen.findByTestId("review-line-t1")).getByRole("button", { name: "Accept" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply to 1 other" }));
    fireEvent.click(await screen.findByTestId("break-pair-confirm"));

    expect(await screen.findByTestId("resolved-line-t3")).toBeVisible();
    expect(server.calls.at(-1)?.body).toEqual({ categoryId: "c1", confirmBreakPairs: true });
    expect(screen.queryByTestId("break-pair-modal")).toBeNull();
  });
});
