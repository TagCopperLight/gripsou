import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";

import { CategoriesSurface } from "./CategoriesSurface";
import type { BudgetCategory } from "../../../api/wire";
import i18n from "../../../i18n";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

function cat(over: Partial<BudgetCategory>): BudgetCategory {
  return {
    id: "x", name: "X", defaultKey: null, color: "#9bb06b", icon: "shopping-cart",
    hint: null, kind: "expense", systemKey: null, archived: false, txCount: 0, ...over,
  };
}

const ROWS: BudgetCategory[] = [
  cat({ id: "sys", name: "Internal transfer", defaultKey: "internal", kind: "neutral",
        systemKey: "internal_transfer", color: "#aeaaa7", icon: "arrow-left-right", txCount: 8 }),
  cat({ id: "ign", name: "Ignore", defaultKey: "ignore", kind: "neutral", icon: "eye-off" }),
  cat({ id: "sal", name: "Salary", defaultKey: "salary", kind: "income", icon: "wallet", txCount: 42 }),
  cat({ id: "gro", name: "Groceries", defaultKey: "groceries", kind: "expense",
        hint: "Supermarkets and corner shops", txCount: 137 }),
  cat({ id: "old", name: "Old category", kind: "expense", archived: true, txCount: 5 }),
];

function renderSurface() {
  return renderWithApp(<CategoriesSurface />);
}

/** Waits for the write and its invalidation refetch, so no state update lands after the test returns (a leaked act() warning in the next test). */
async function waitForFullSettle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await waitFor(() => expect(client.isMutating()).toBe(0));
}

describe("CategoriesSurface", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse(ROWS));
  });

  it("lists the unarchived rows grouped expense → income → neutral", async () => {
    renderSurface();
    await screen.findByText("Groceries");
    const names = screen.getAllByTestId("category-name").map((n) => n.textContent);
    expect(names).toEqual(["Groceries", "Salary", "Internal transfer", "Ignore"]);
    expect(screen.queryByText("Old category")).toBeNull();
  });

  it("marks the system row, and leaves archive and delete out of its window", async () => {
    renderSurface();
    const row = (await screen.findByText("Internal transfer")).closest<HTMLElement>("[role=listitem]")!;
    expect(within(row).getByTestId("system-lock")).toHaveTextContent("System");
    fireEvent.click(within(row).getByRole("button", { name: "Modify Internal transfer" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(dialog).getByTitle(/only its name, colour and icon/)).toBeVisible();
  });

  describe("reordering", () => {
    const THREE: BudgetCategory[] = [
      cat({ id: "a", name: "Alpha", kind: "expense" }),
      cat({ id: "b", name: "Beta", kind: "expense" }),
      cat({ id: "c", name: "Gamma", kind: "expense" }),
      cat({ id: "sal", name: "Salary", kind: "income" }),
    ];

    function mockRows(rows: BudgetCategory[]) {
      stubFetch(async (_url: string, init?: RequestInit) =>
          init?.method === "PUT" ? new Response(null, { status: 204 }) : jsonResponse(rows));
    }

    function putBody() {
      const call = vi.mocked(fetch).mock.calls.find((c) => (c[1] as RequestInit)?.method === "PUT")!;
      return JSON.parse((call[1] as RequestInit).body as string);
    }

    it("moves a row up and saves every id in the new order", async () => {
      mockRows(THREE);
      const { client } = renderSurface();
      await screen.findByText("Beta");
      fireEvent.click(screen.getByRole("button", { name: "Move Beta up" }));

      await waitFor(() => expect(putBody()).toEqual({ ids: ["b", "a", "c", "sal"] }));
      await waitForFullSettle(client);
    });

    it("moves the row on screen before the server answers", async () => {
            // The PUT hangs, so the screen can only show the optimistic order.
      let answer: (r: Response) => void = () => {};
      stubFetch(async (_url: string, init?: RequestInit) =>
          init?.method === "PUT"
            ? new Promise<Response>((res) => {
                answer = res;
              })
            : jsonResponse(THREE));
      const { client } = renderSurface();
      await screen.findByText("Beta");
      fireEvent.click(screen.getByRole("button", { name: "Move Beta up" }));

      await waitFor(() =>
        expect(screen.getAllByTestId("category-name").map((n) => n.textContent)).toEqual([
          "Beta", "Alpha", "Gamma", "Salary",
        ]),
      );
      await act(async () => {
        answer(new Response(null, { status: 204 }));
      });
      await waitForFullSettle(client);
    });

    it("moves a row down", async () => {
      mockRows(THREE);
      const { client } = renderSurface();
      await screen.findByText("Beta");
      fireEvent.click(screen.getByRole("button", { name: "Move Alpha down" }));
      await waitFor(() => expect(putBody()).toEqual({ ids: ["b", "a", "c", "sal"] }));
      await waitForFullSettle(client);
    });

    it("kills the arrow at each end of a kind, counting kinds separately", async () => {
      mockRows(THREE);
      renderSurface();
      await screen.findByText("Beta");
      expect(screen.getByRole("button", { name: "Move Alpha up" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Gamma down" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Beta up" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Move Beta down" })).toBeEnabled();
            // Salary is alone in its kind, so it cannot move: a row never crosses into another kind's block.
      expect(screen.getByRole("button", { name: "Move Salary up" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Salary down" })).toBeDisabled();
    });

    it("moves one visible place even when an archived row sits in between", async () => {
      mockRows([
        cat({ id: "a", name: "Alpha", kind: "expense" }),
        cat({ id: "hid", name: "Hidden", kind: "expense", archived: true }),
        cat({ id: "c", name: "Gamma", kind: "expense" }),
      ]);
      const { client } = renderSurface();
      await screen.findByText("Gamma");
      fireEvent.click(screen.getByRole("button", { name: "Move Gamma up" }));
      // Gamma passes Alpha, the row it can actually see; Hidden is carried
      // along rather than being the thing Gamma swaps with.
      await waitFor(() => expect(putBody()).toEqual({ ids: ["c", "a", "hid"] }));
      await waitForFullSettle(client);
    });

    it("puts the list back if the write fails", async () => {
      stubFetch(async (_url: string, init?: RequestInit) =>
          init?.method === "PUT" ? new Response("nope", { status: 500 }) : jsonResponse(THREE));
      const { client } = renderSurface();
      await screen.findByText("Beta");
      fireEvent.click(screen.getByRole("button", { name: "Move Beta up" }));
      await screen.findByRole("alert");
      await waitFor(() =>
        expect(screen.getAllByTestId("category-name").map((n) => n.textContent)).toEqual([
          "Alpha", "Beta", "Gamma", "Salary",
        ]),
      );
      await waitForFullSettle(client);
    });
  });

  it("reveals archived rows behind the toggle and restores one with the full stored body", async () => {
    const { client } = renderSurface();
    await screen.findByText("Groceries");
    expect(screen.queryByText("Old category")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show archived (1)" }));
    expect(screen.getByText("Old category")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Move Old category up" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Modify Old category" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restore" }));
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitForFullSettle(client);
  });

  it("archives a seeded row without ever sending its translated label as the name", async () => {
    const { client } = renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Modify Groceries" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    await waitFor(() => {
      const body = JSON.parse(
        (vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith("/gro"))![1] as RequestInit).body as string,
      );
      expect(body).toEqual({
        name: "Groceries", color: "#9bb06b", icon: "shopping-cart",
        hint: "Supermarkets and corner shops", kind: "expense", archived: true,
      });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitForFullSettle(client);
  });

  describe("in French, where the displayed label diverges from the stored name", () => {
    afterEach(async () => {
            // The surface is still mounted (this hook runs before testing-library's unmount), so reverting the language must be inside act().
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });

      it("archives 'Courses' by sending the stored name 'Groceries', not the displayed label", async () => {
      await act(async () => {
        await i18n.changeLanguage("fr");
      });
      const { client } = renderSurface();
      fireEvent.click(await screen.findByRole("button", { name: "Modifier Courses" }));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archiver" }));
      await waitFor(() => {
        const body = JSON.parse(
          (vi.mocked(fetch).mock.calls.find((c) => String(c[0]).endsWith("/gro"))![1] as RequestInit).body as string,
        );
        expect(body).toEqual({
          name: "Groceries", color: "#9bb06b", icon: "shopping-cart",
          hint: "Supermarkets and corner shops", kind: "expense", archived: true,
        });
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitForFullSettle(client);
    });
  });

  it("keeps the window open and says so when archiving fails", async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("boom", { status: 500 })
        : jsonResponse(ROWS),
    );
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Modify Groceries" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the category");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("deletes from the window only after confirmation", async () => {
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Modify Groceries" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete category" })).toBeVisible();
    expect(screen.getByText(/137 transactions are kept/)).toBeVisible();
    expect(
      vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "DELETE"),
    ).toHaveLength(0);
  });

  it("has its own loading, error-with-retry and empty states", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("no", { status: 500 }));
    renderSurface();
    const retry = await screen.findByRole("button", { name: /retry|réessayer/i });
    expect(screen.getByRole("button", { name: "Add category" })).toBeDisabled();
    vi.mocked(fetch).mockImplementation(async () => jsonResponse([]));
    fireEvent.click(retry);
    expect(await screen.findByText("No categories yet.")).toBeVisible();
  });
});

