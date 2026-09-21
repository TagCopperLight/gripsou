import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { SettingsBudget } from "./Budget";
import type { BudgetCategory, BudgetTag } from "../../api/budget";
import i18n from "../../i18n";

function cat(over: Partial<BudgetCategory>): BudgetCategory {
  return {
    id: "x",
    name: "X",
    defaultKey: null,
    color: "#9bb06b",
    icon: "shopping-cart",
    hint: null,
    kind: "expense",
    systemKey: null,
    archived: false,
    txCount: 0,
    ...over,
  };
}

function tag(over: Partial<BudgetTag>): BudgetTag {
  return { id: "x", name: "X", color: "#5b9bf0", txCount: 0, ...over };
}

type ServerState = { categories: BudgetCategory[]; tags: BudgetTag[] };

function jsonRes(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : { "Content-Type": "application/json" },
  });
}

let nextId = 100;

// An in-memory fixture backend: keeps arrays of categories/tags and mutates
// them like the real API would, so a refetch after a write reflects what the
// write actually did rather than an optimistic guess.
function makeServer(initial: ServerState) {
  const state: ServerState = structuredClone(initial);

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^\/api/, "");
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    const collectionMatch = path.match(/^\/budget\/(categories|tags)$/);
    const itemMatch = path.match(/^\/budget\/(categories|tags)\/(.+)$/);

    if (collectionMatch) {
      const kind = collectionMatch[1] as "categories" | "tags";
      const list = kind === "categories" ? state.categories : state.tags;
      if (method === "GET") return jsonRes(list);
      if (method === "POST") {
        if (list.some((r) => r.name === body.name)) return jsonRes("dup", 409);
        const id = `${kind[0]}${nextId++}`;
        const row =
          kind === "categories"
            ? cat({ ...body, id, defaultKey: null, systemKey: null, txCount: 0 })
            : tag({ ...body, id, txCount: 0 });
        list.push(row as never);
        return jsonRes(row, 201);
      }
    }

    if (itemMatch) {
      const kind = itemMatch[1] as "categories" | "tags";
      const id = itemMatch[2];
      const list = kind === "categories" ? state.categories : state.tags;
      const idx = list.findIndex((r) => r.id === id);
      if (idx === -1) return jsonRes("gone", 404);

      if (method === "PATCH") {
        if (list.some((r) => r.id !== id && r.name === body.name)) return jsonRes("dup", 409);
        const current = list[idx];
        const defaultKey =
          kind === "categories" && "defaultKey" in current
            ? body.name === current.name
              ? (current as BudgetCategory).defaultKey
              : null
            : undefined;
        list[idx] = { ...current, ...body, ...(defaultKey !== undefined ? { defaultKey } : {}) } as never;
        return jsonRes(list[idx]);
      }
      if (method === "DELETE") {
        list.splice(idx, 1);
        return jsonRes(null, 204);
      }
    }

    return jsonRes("not found", 404);
  });

  return { state, fetch: fetchMock };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<SettingsBudget />, { wrapper: Wrapper });
}

const SEED: ServerState = {
  categories: [
    cat({
      id: "c1",
      name: "Groceries",
      defaultKey: "groceries",
      color: "#9bb06b",
      icon: "shopping-cart",
      hint: null,
      kind: "expense",
      txCount: 5,
    }),
  ],
  tags: [tag({ id: "t1", name: "Holiday", color: "#5b9bf0", txCount: 4 })],
};

describe("SettingsBudget page", () => {
  it("creates, edits, archives, restores, and deletes a category, reflecting the refetched server state", async () => {
    const server = makeServer(SEED);
    vi.stubGlobal("fetch", server.fetch);
    renderPage();
    await screen.findByText("Groceries");

    // Create.
    fireEvent.click(screen.getByRole("button", { name: "Add category" }));
    const nameInput = await screen.findByLabelText("Name");
    fireEvent.change(nameInput, { target: { value: "Coffee" } });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));
    await screen.findByText("Coffee", { selector: '[data-testid="category-name"]' });
    expect(server.state.categories.find((c) => c.name === "Coffee")).toBeTruthy();

    // Edit (give it a hint).
    fireEvent.click(screen.getByRole("button", { name: "Modify Coffee" }));
    const hintInput = await screen.findByLabelText("Hint for the AI");
    fireEvent.change(hintInput, { target: { value: "Coffee shops" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(server.state.categories.find((c) => c.name === "Coffee")?.hint).toBe("Coffee shops"),
    );
    const coffeeRow = (
      await screen.findByText("Coffee", { selector: '[data-testid="category-name"]' })
    ).closest("tr")!;
    await within(coffeeRow).findByText("Coffee shops");

    // Archive: disappears from the default view, reappears behind the toggle.
    fireEvent.click(screen.getByRole("button", { name: "Archive Coffee" }));
    await waitFor(() => expect(screen.queryByText("Coffee")).toBeNull());
    expect(server.state.categories.find((c) => c.name === "Coffee")?.archived).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Show archived/ }));
    await screen.findByText("Coffee", { selector: '[data-testid="category-name"]' });

    // Restore.
    fireEvent.click(screen.getByRole("button", { name: "Restore Coffee" }));
    await waitFor(() => expect(server.state.categories.find((c) => c.name === "Coffee")?.archived).toBe(false));
    await screen.findByText("Coffee", { selector: '[data-testid="category-name"]' });

    // Delete.
    fireEvent.click(screen.getByRole("button", { name: "Delete Coffee" }));
    expect(await screen.findByRole("dialog", { name: "Delete category" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() => expect(screen.queryByText("Coffee")).toBeNull());
    expect(server.state.categories.find((c) => c.name === "Coffee")).toBeUndefined();
  });

  it("creates, renames, recolours, and deletes a tag, reflecting the refetched server state", async () => {
    const server = makeServer(SEED);
    vi.stubGlobal("fetch", server.fetch);
    renderPage();
    await screen.findByText("Holiday");

    // Create.
    fireEvent.change(screen.getByLabelText("Tag name"), { target: { value: "Trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Trip");
    expect(server.state.tags.find((t) => t.name === "Trip")).toBeTruthy();

    // Rename.
    fireEvent.click(screen.getByRole("button", { name: "Modify Trip" }));
    fireEvent.change(screen.getByDisplayValue("Trip"), { target: { value: "Roadtrip" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(server.state.tags.find((t) => t.id !== "t1")?.name).toBe("Roadtrip"));
    await screen.findByText("Roadtrip");

    // Recolour.
    fireEvent.click(screen.getByRole("button", { name: "Colour of Roadtrip" }));
    fireEvent.click(screen.getByRole("button", { name: "Colour #4dd0b1" }));
    await waitFor(() =>
      expect(server.state.tags.find((t) => t.name === "Roadtrip")?.color).toBe("#4dd0b1"),
    );

    // Delete.
    fireEvent.click(screen.getByRole("button", { name: "Delete Roadtrip" }));
    expect(await screen.findByRole("dialog", { name: "Delete tag" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
    await waitFor(() => expect(screen.queryByText("Roadtrip")).toBeNull());
    expect(server.state.tags.find((t) => t.name === "Roadtrip")).toBeUndefined();
  });

  it("never issues a write to /transactions", async () => {
    const server = makeServer(SEED);
    vi.stubGlobal("fetch", server.fetch);
    renderPage();
    await screen.findByText("Groceries");
    await screen.findByText("Holiday");

    fireEvent.change(screen.getByLabelText("Tag name"), { target: { value: "Trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByText("Trip");

    expect(
      server.fetch.mock.calls.filter(
        ([u, i]) => String(u).includes("/transactions") && (i as RequestInit | undefined)?.method,
      ).length,
    ).toBe(0);
  });

  it("keeps each list independent: one query failing does not block the other", async () => {
    const failingCategories = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/budget/categories")) return jsonRes("down", 500);
      const server = makeServer(SEED);
      return server.fetch(url, init);
    });
    vi.stubGlobal("fetch", failingCategories);
    renderPage();
    await screen.findByText("Holiday");
    expect(await screen.findByRole("button", { name: /retry|réessayer/i })).toBeVisible();
  });

  it("keeps each list independent: the reverse failure still renders categories", async () => {
    const failingTags = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/budget/tags")) return jsonRes("down", 500);
      const server = makeServer(SEED);
      return server.fetch(url, init);
    });
    vi.stubGlobal("fetch", failingTags);
    renderPage();
    await screen.findByText("Groceries");
    expect(await screen.findByRole("button", { name: /retry|réessayer/i })).toBeVisible();
  });

  describe("in French", () => {
    afterEach(async () => {
      // The page (and its CategoriesSurface/TagsSurface/TagRow) is still
      // mounted here — this hook runs before testing-library's own unmount —
      // so reverting the language re-renders them and must be inside act().
      await act(async () => {
        await i18n.changeLanguage("en");
      });
    });

    it("translates headings and seeded rows while keeping user-created names verbatim", async () => {
      await i18n.changeLanguage("fr");
      const server = makeServer(SEED);
      vi.stubGlobal("fetch", server.fetch);
      renderPage();

      expect(await screen.findByText("Catégories")).toBeVisible();
      expect(screen.getByText("Étiquettes")).toBeVisible();
      expect(await screen.findByText("Courses")).toBeVisible();

      fireEvent.click(screen.getByRole("button", { name: "Ajouter une catégorie" }));
      const nameInput = await screen.findByLabelText("Nom");
      fireEvent.change(nameInput, { target: { value: "Coffee" } });
      fireEvent.click(screen.getByRole("button", { name: "Créer la catégorie" }));
      expect(
        await screen.findByText("Coffee", { selector: '[data-testid="category-name"]' }),
      ).toBeVisible();
    });
  });

  it("shows none of the out-of-scope surfaces for this phase", async () => {
    const server = makeServer(SEED);
    vi.stubGlobal("fetch", server.fetch);
    renderPage();
    await screen.findByText("Groceries");
    await screen.findByText("Holiday");

    for (const phrase of [
      /categorise now/i,
      /confidence threshold/i,
      /run log/i,
      /checked.column/i,
      /rules engine/i,
    ]) {
      expect(screen.queryByText(phrase)).toBeNull();
    }
  });

  it("supports opening, tabbing into, typing, submitting and closing the category modal by keyboard", async () => {
    const user = userEvent.setup();
    const server = makeServer(SEED);
    vi.stubGlobal("fetch", server.fetch);
    renderPage();
    await screen.findByText("Groceries");

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await screen.findByRole("dialog", { name: "New category" });
    await user.tab();
    await user.keyboard("Bakery");
    await user.keyboard("{Enter}");
    await screen.findByText("Bakery", { selector: '[data-testid="category-name"]' });

    await user.click(screen.getByRole("button", { name: "Add category" }));
    await screen.findByRole("dialog", { name: "New category" });
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New category" })).toBeNull());
  });
});
