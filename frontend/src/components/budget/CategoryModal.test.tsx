import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { CategoryModal } from "./CategoryModal";
import { DeleteCategoryModal } from "./DeleteCategoryModal";
import type { BudgetCategory } from "../../api/budget";
import i18n from "../../i18n";

function cat(over: Partial<BudgetCategory>): BudgetCategory {
  return {
    id: "x", name: "X", defaultKey: null, color: "#9bb06b", icon: "shopping-cart",
    hint: null, kind: "expense", systemKey: null, archived: false, txCount: 0, ...over,
  };
}

const GROCERIES = cat({
  id: "c1", name: "Groceries", defaultKey: "groceries", kind: "expense",
  hint: "Supermarkets and corner shops", txCount: 137,
});

const SYSTEM = cat({
  id: "sys", name: "Internal transfer", defaultKey: "internal", kind: "internal",
  systemKey: "internal_transfer", color: "#aeaaa7", icon: "arrow-left-right", txCount: 8,
});

const client = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const wrapper = Wrapper;

function jsonOnce(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderModal(props: { category?: BudgetCategory; onClose?: () => void } = {}) {
  return render(
    <CategoryModal category={props.category} onClose={props.onClose ?? vi.fn()} />,
    { wrapper },
  );
}

describe("CategoryModal — create", () => {
  it("previews the typed name in the heading, refuses a blank one, and POSTs a trimmed body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce({ ...cat({ id: "new" }) }, 201)));
    renderModal();                                   // no `category` prop
    expect(screen.getByTestId("category-preview")).toHaveTextContent("New category");
    const submit = screen.getByRole("button", { name: "Create category" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  Coffee  " } });
    expect(screen.getByTestId("category-preview")).toHaveTextContent("Coffee");
    fireEvent.click(submit);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/categories",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            name: "Coffee", color: "#5b9bf0", icon: null, hint: null,
            kind: "expense", archived: false,
          }),
        }),
      ),
    );
  });

  it("keeps the draft and explains a 409 instead of closing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("dup", { status: 409 })));
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Groceries" } });
    fireEvent.click(screen.getByRole("button", { name: "Create category" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A category with this name already exists.",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Groceries");
  });

  it("does not fire a second write while the first is in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    renderModal();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Coffee" } });
    const submit = screen.getByRole("button", { name: "Create category" });
    fireEvent.click(submit);
    await waitFor(() => expect(submit).toBeDisabled());
    fireEvent.click(submit);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    resolve(jsonOnce(cat({ id: "new" }), 201));
  });
});

describe("CategoryModal — edit", () => {
  it("sends the raw stored name when a translated seed's other fields change", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(GROCERIES)));
    renderModal({ category: GROCERIES });            // defaultKey "groceries", name "Groceries"
    expect(screen.getByLabelText("Name")).toHaveValue("Groceries");
    fireEvent.change(screen.getByLabelText("Hint for the AI"), { target: { value: "Supermarkets" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ name: "Groceries", hint: "Supermarkets" });
    });
  });

  it("sends the user's literal text once they actually rename it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(GROCERIES)));
    renderModal({ category: GROCERIES });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Mes courses" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => {
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.name).toBe("Mes courses");
    });
  });

  it("a language switch with the draft open is not a rename", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(GROCERIES)));
    renderModal({ category: GROCERIES });
    // Edit something unrelated first, so Save has a real reason to be
    // enabled — a bare language switch with nothing else touched is a
    // no-op and Save should stay disabled for it.
    fireEvent.change(screen.getByLabelText("Hint for the AI"), { target: { value: "Supermarkets" } });
    await act(async () => { await i18n.changeLanguage("fr"); });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body).toMatchObject({ name: "Groceries", hint: "Supermarkets" }); // not "Courses"
    });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("a language switch mid-draft, then manually retyping the now-current translated label, is still not a rename", async () => {
    // Regression for the frozen-`initialDisplayName` bug: the modal opened in
    // English (initialDisplayName = "Groceries"), then the app language flips
    // to French. If the user now types exactly what the French label reads
    // ("Courses") — believing they're just confirming the shown name — the
    // old check (`trimmed === initialDisplayName`) would treat that as a real
    // rename and send the literal "Courses", un-seeding the row. The fix also
    // accepts a match against the *current* categoryLabel(t, category).
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(GROCERIES)));
    renderModal({ category: GROCERIES });
    expect(screen.getByLabelText("Name")).toHaveValue("Groceries");
    await act(async () => { await i18n.changeLanguage("fr"); });
    // Touch an unrelated field too, so Save has a reason to be enabled — a
    // bare retype of the same-meaning name is otherwise a no-op.
    fireEvent.change(screen.getByLabelText("Indice pour l'IA"), { target: { value: "Supermarchés" } });
    fireEvent.change(screen.getByLabelText("Nom"), { target: { value: "Courses" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.name).toBe("Groceries");
    });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("mounted while already French, sends the raw stored name, not the displayed 'Courses'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(GROCERIES)));
    await act(async () => { await i18n.changeLanguage("fr"); });
    renderModal({ category: GROCERIES });
    // The name field genuinely shows the French label at mount — this is
    // what makes the assertion below meaningful, rather than vacuously true.
    expect(screen.getByLabelText("Nom")).toHaveValue("Courses");
    fireEvent.change(screen.getByLabelText("Indice pour l'IA"), { target: { value: "Supermarchés" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => {
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
      expect(body.name).toBe("Groceries");
    });
    await act(async () => { await i18n.changeLanguage("en"); });
  });

  it("disables saving until something changes, and re-enables on a colour change alone", () => {
    renderModal({ category: GROCERIES });
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Colour #4dd0b1" }));
    expect(save).toBeEnabled();
  });

  it("locks the kind and the hint of the system category, but not name, colour or icon", () => {
    renderModal({ category: SYSTEM });
    const kind = screen.getByLabelText("Kind");
    expect(kind).toBeDisabled();
    expect(kind).toHaveTextContent("Internal");
    expect(screen.getByText("This kind is fixed for the system category.")).toBeVisible();

    expect(screen.getByLabelText("Hint for the AI")).toBeDisabled();

    // What is still the user's to change on the system row.
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Colour #4dd0b1" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Piggy bank" })).toBeEnabled();
  });

  it("explains a 404 as a vanished row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    renderModal({ category: GROCERIES });
    fireEvent.change(screen.getByLabelText("Hint for the AI"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This category no longer exists.");
  });

  it("cannot be dismissed while the write is in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    const onClose = vi.fn();
    renderModal({ category: GROCERIES, onClose });
    fireEvent.change(screen.getByLabelText("Hint for the AI"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /close/i })).toBeDisabled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    resolve(jsonOnce(GROCERIES));
  });

  it("closes on Cancel and on Escape when idle", () => {
    const onClose = vi.fn();
    renderModal({ category: GROCERIES, onClose });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("DeleteCategoryModal", () => {
  it("says the transactions survive, then DELETEs on confirmation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const onClose = vi.fn();
    render(<DeleteCategoryModal category={GROCERIES} onClose={onClose} />, { wrapper });
    expect(screen.getByText(/137 transactions are kept and become uncategorised/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/budget/categories/c1", expect.objectContaining({ method: "DELETE" })),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("stays open and explains a failed deletion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 500 })));
    const onClose = vi.fn();
    render(<DeleteCategoryModal category={GROCERIES} onClose={onClose} />, { wrapper });
    fireEvent.click(screen.getByRole("button", { name: "Delete category" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That category could not be deleted.");
    expect(onClose).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});
