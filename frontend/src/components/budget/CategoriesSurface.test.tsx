import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { CategoriesSurface } from "./CategoriesSurface";
import type { BudgetCategory } from "../../api/budget";
import i18n from "../../i18n";

function cat(over: Partial<BudgetCategory>): BudgetCategory {
  return {
    id: "x", name: "X", defaultKey: null, color: "#9bb06b", icon: "shopping-cart",
    hint: null, kind: "expense", systemKey: null, archived: false, txCount: 0, ...over,
  };
}

const ROWS: BudgetCategory[] = [
  cat({ id: "sys", name: "Internal transfer", defaultKey: "internal", kind: "internal",
        systemKey: "internal_transfer", color: "#aeaaa7", icon: "arrow-left-right", txCount: 8 }),
  cat({ id: "ign", name: "Ignore", defaultKey: "ignore", kind: "excluded", icon: "eye-off" }),
  cat({ id: "sal", name: "Salary", defaultKey: "salary", kind: "income", icon: "wallet", txCount: 42 }),
  cat({ id: "gro", name: "Groceries", defaultKey: "groceries", kind: "expense",
        hint: "Supermarkets and corner shops", txCount: 137 }),
  cat({ id: "old", name: "Old category", kind: "expense", archived: true, txCount: 5 }),
];

function renderSurface() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { ...render(<CategoriesSurface />, { wrapper: Wrapper }), client };
}

/** Waits for the write itself AND the cache-invalidation refetch it kicks off
 *  to both finish, so no state update from either lands after the test body
 *  returns (which is what causes a leaked act() warning in the *next* test). */
async function waitForFullSettle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() => expect(client.isMutating()).toBe(0));
}

function jsonOnce(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("CategoriesSurface", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(ROWS)));
  });

  it("lists the unarchived rows grouped expense → income → internal → excluded", async () => {
    renderSurface();
    await screen.findByText("Groceries");
    const names = screen.getAllByTestId("category-name").map((n) => n.textContent);
    expect(names).toEqual(["Groceries", "Salary", "Internal transfer", "Ignore"]);
    expect(screen.queryByText("Old category")).toBeNull();
  });

  it("shows the hint and the integer row count", async () => {
    renderSurface();
    const row = (await screen.findByText("Groceries")).closest("tr")!;
    expect(within(row).getByText("Supermarkets and corner shops")).toBeVisible();
    expect(within(row).getByText("137")).toBeVisible();
    expect(within(row).getByText("Expense")).toBeVisible();
  });

  it("locks the system row: a SYSTEM badge, a lock instead of actions, an editable name", async () => {
    renderSurface();
    const row = (await screen.findByText("Internal transfer")).closest("tr")!;
    expect(within(row).getByText("SYSTEM")).toBeVisible();
    expect(within(row).queryByRole("button", { name: "Archive Internal transfer" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Delete Internal transfer" })).toBeNull();
    expect(within(row).getByTestId("system-lock")).toBeVisible();
    expect(within(row).getByRole("button", { name: "Modify Internal transfer" })).toBeVisible();
  });

  it("reveals archived rows behind the toggle and restores one with the full stored body", async () => {
    const { client } = renderSurface();
    await screen.findByText("Groceries");
    fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));
    expect(screen.getByText("Old category")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Restore Old category" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/categories/old",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            name: "Old category", color: "#9bb06b", icon: "shopping-cart",
            hint: null, kind: "expense", archived: false,
          }),
        }),
      ),
    );
    // Let the write AND the cache-invalidation refetch it triggers both
    // settle (row re-enabled) before the test returns, so no state update
    // from either fires against an unmounted/next test.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Restore Old category" })).toBeEnabled(),
    );
    await waitForFullSettle(client);
  });

  it("archives a seeded row without ever sending its translated label as the name", async () => {
    const { client } = renderSurface();
    await screen.findByText("Groceries");
    fireEvent.click(screen.getByRole("button", { name: "Archive Groceries" }));
    await waitFor(() => {
      const body = JSON.parse(
        (vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith("/gro"))![1] as RequestInit).body as string,
      );
      expect(body).toEqual({
        name: "Groceries", color: "#9bb06b", icon: "shopping-cart",
        hint: "Supermarkets and corner shops", kind: "expense", archived: true,
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Archive Groceries" })).toBeEnabled(),
    );
    await waitForFullSettle(client);
  });

  // In English the "groceries" default-key translation is byte-identical to
  // the stored name, so this exact assertion above would still pass even if
  // the implementation sent `categoryLabel(t, c)` instead of `c.name` — it
  // would not catch a regression. French genuinely diverges ("Courses" vs.
  // the stored "Groceries"), which is what actually exercises the rule that
  // an archive/restore PATCH must carry the raw stored name.
  describe("in French, where the displayed label diverges from the stored name", () => {
    afterEach(async () => {
      // The surface is still mounted at this point (this hook runs before
      // testing-library's own unmount, which is registered as an outer
      // afterEach) — reverting the language re-renders it, so that has to be
      // inside act() or it warns as an update outside a test.
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });

    it("archives 'Courses' by sending the stored name 'Groceries', not the displayed label", async () => {
      await i18n.changeLanguage("fr");
      const { client } = renderSurface();
      await screen.findByText("Courses");
      fireEvent.click(screen.getByRole("button", { name: "Archiver Courses" }));
      await waitFor(() => {
        const body = JSON.parse(
          (vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith("/gro"))![1] as RequestInit).body as string,
        );
        expect(body).toEqual({
          name: "Groceries", color: "#9bb06b", icon: "shopping-cart",
          hint: "Supermarkets and corner shops", kind: "expense", archived: true,
        });
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Archiver Courses" })).toBeEnabled(),
      );
      await waitForFullSettle(client);
    });
  });

  it("reports a failed action inline and keeps the table usable", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("boom", { status: 500 })
        : jsonOnce(ROWS),
    );
    renderSurface();
    await screen.findByText("Groceries");
    fireEvent.click(screen.getByRole("button", { name: "Archive Groceries" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That change could not be saved. Please try again.",
    );
    expect(screen.getByText("Groceries")).toBeVisible();
  });

  it("opens the edit modal from Modify", async () => {
    renderSurface();
    await screen.findByText("Groceries");
    fireEvent.click(screen.getByRole("button", { name: "Modify Groceries" }));
    expect(await screen.findByRole("dialog", { name: "Edit category" })).toBeVisible();
  });

  it("opens the delete modal from Delete", async () => {
    renderSurface();
    await screen.findByText("Groceries");
    fireEvent.click(screen.getByRole("button", { name: "Delete Groceries" }));
    expect(await screen.findByRole("dialog", { name: "Delete category" })).toBeVisible();
  });

  it("has its own loading, error-with-retry and empty states", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("no", { status: 500 }));
    renderSurface();
    const retry = await screen.findByRole("button", { name: /retry|réessayer/i });
    vi.mocked(fetch).mockImplementation(async () => jsonOnce([]));
    fireEvent.click(retry);
    expect(await screen.findByText("No categories yet.")).toBeVisible();
  });

  it("keeps a row disabled until its OWN write settles, independent of another row's in-flight write", async () => {
    const resolvers: Record<string, (r: Response) => void> = {};
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((init as RequestInit | undefined)?.method === "PATCH") {
        const id = String(url).split("/").pop()!;
        return new Promise<Response>((resolve) => {
          resolvers[id] = resolve;
        });
      }
      return jsonOnce(ROWS);
    });
    const { client } = renderSurface();
    await screen.findByText("Groceries");

    fireEvent.click(screen.getByRole("button", { name: "Archive Groceries" })); // id "gro"
    fireEvent.click(screen.getByRole("button", { name: "Archive Ignore" })); // id "ign"
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive Groceries" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Archive Ignore" })).toBeDisabled();
    });

    // Groceries' write settles first...
    resolvers["gro"](jsonOnce(ROWS));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Archive Groceries" })).toBeEnabled(),
    );
    // ...but Ignore's write is still in flight, so it must stay disabled.
    expect(screen.getByRole("button", { name: "Archive Ignore" })).toBeDisabled();

    resolvers["ign"](jsonOnce(ROWS));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Archive Ignore" })).toBeEnabled(),
    );
    await waitForFullSettle(client);
  });

  it("clears the sticky action error on the next surface interaction, not just the next archive attempt", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("boom", { status: 500 })
        : jsonOnce(ROWS),
    );
    const { client } = renderSurface();
    await screen.findByText("Groceries");

    fireEvent.click(screen.getByRole("button", { name: "Archive Groceries" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Archive Groceries" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Modify Groceries" }));
    expect(screen.queryByRole("alert")).toBeNull();
    await waitForFullSettle(client);
  });
});
