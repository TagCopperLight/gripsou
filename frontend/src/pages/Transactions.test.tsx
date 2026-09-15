import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Transactions } from "./Transactions";
import type { Transaction } from "../api/types";

vi.mock("../api/hooks", async () => {
  const actual = await vi.importActual<typeof import("../api/hooks")>("../api/hooks");
  return {
    ...actual,
    useAccounts: () => ({ data: [{ id: "a1", name: "Current account" }], isLoading: false }),
    useTransactions: vi.fn(),
  };
});

import { useTransactions } from "../api/hooks";

const rows: Transaction[] = [
  {
    id: "1", t: Date.UTC(2026, 2, 14), type: "withdrawal", description: "LECLERC",
    amount: "-42.50", currency: "EUR",
    accountId: "a1", accountName: "Current account", accountColor: null,
    source: "cash", ticker: null, quantity: null, unitPrice: null, fee: null,
  },
];

function infiniteResult(pages: (typeof rows)[], overrides: Record<string, unknown> = {}) {
  return {
    data: { pages, pageParams: pages.map((_, i) => i) },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Transactions />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(useTransactions).mockReturnValue(infiniteResult([rows]) as never);
});

describe("Transactions", () => {
  it("renders a row per transaction", () => {
    renderPage();
    expect(screen.getByText("LECLERC")).toBeInTheDocument();
    expect(screen.getByText("Current account")).toBeInTheDocument();
  });

  it("passes the typed search term to the query, debounced", async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/search/i), "leclerc");
    await waitFor(() =>
      expect(vi.mocked(useTransactions)).toHaveBeenCalledWith(
        expect.objectContaining({ search: "leclerc" }),
      ),
    );
  });

  it("shows the empty state when nothing matches", () => {
    vi.mocked(useTransactions).mockReturnValue(infiniteResult([[]]) as never);
    renderPage();
    expect(screen.getByText(/no transactions match/i)).toBeInTheDocument();
  });

  it("shows how many rows are currently shown", () => {
    renderPage();
    expect(screen.getByText(/showing 1 transaction/i)).toBeInTheDocument();
  });

  it("shows a load-more button when the last page came back full, and fetches the next page on click", async () => {
    const fetchNextPage = vi.fn();
    vi.mocked(useTransactions).mockReturnValue(
      infiniteResult([rows], { hasNextPage: true, fetchNextPage }) as never,
    );
    renderPage();
    const button = screen.getByRole("button", { name: /load more/i });
    await userEvent.click(button);
    expect(fetchNextPage).toHaveBeenCalled();
  });

  it("hides the load-more button once the last page came back short", () => {
    renderPage(); // default mock: hasNextPage: false
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("disables the load-more button while fetching the next page", () => {
    vi.mocked(useTransactions).mockReturnValue(
      infiniteResult([rows], { hasNextPage: true, isFetchingNextPage: true }) as never,
    );
    renderPage();
    expect(screen.getByRole("button", { name: /loading/i })).toBeDisabled();
  });

  it("renders a lot row with its instrument and quantity", async () => {
    const lotRow: Transaction = {
      id: "2", t: Date.UTC(2025, 5, 3), type: "buy", description: null,
      amount: "-210.53", currency: "EUR",
      accountId: "a1", accountName: "Current account", accountColor: null,
      source: "lot", ticker: "PUST", quantity: "2", unitPrice: "104.74", fee: "1.05",
    };
    vi.mocked(useTransactions).mockReturnValue(infiniteResult([[lotRow]]) as never);
    renderPage();
    expect(await screen.findByText(/PUST/)).toBeInTheDocument();
    // Amount formatting (separators/currency symbol) is exercised elsewhere —
    // here we just confirm the lot's amount reaches the page.
    expect(screen.getByText(/210,53/)).toBeInTheDocument();
  });

  it("resets back to the query's first page when a filter changes", async () => {
    renderPage();
    await userEvent.type(screen.getByPlaceholderText(/search/i), "x");
    await waitFor(() =>
      expect(vi.mocked(useTransactions)).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "x" }),
      ),
    );
    // useInfiniteQuery restarts at page 1 automatically whenever the query
    // key (the filters) changes — there is no separate "current page" state
    // in the component that could get out of sync with the filters.
    expect(vi.mocked(useTransactions)).not.toHaveBeenCalledWith(
      expect.objectContaining({ offset: expect.anything() }),
    );
  });
});
