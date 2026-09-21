import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { TagsSurface } from "./TagsSurface";
import type { BudgetTag } from "../../api/budget";

const TAGS: BudgetTag[] = [
  { id: "t1", name: "Holiday", color: "#5b9bf0", txCount: 4 },
  { id: "t2", name: "Work", color: null, txCount: 0 },
];

function renderSurface() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<TagsSurface />, { wrapper: Wrapper });
}

function jsonOnce(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("TagsSurface", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOnce(TAGS)));
  });

  it("is a plain list, not a table, with a chip per tag", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByTestId("tag-chip")).toHaveLength(2);
  });

  it("adds a trimmed tag and clears only the submitted draft", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled(); // blank draft
    fireEvent.change(screen.getByLabelText("Tag name"), { target: { value: "  Trip  " } });
    fireEvent.click(add);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/tags",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Trip", color: null }) }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText("Tag name")).toHaveValue(""));
  });

  it("saves the new tag on Enter too", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    const input = screen.getByLabelText("Tag name");
    fireEvent.change(input, { target: { value: "Trip" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/budget/tags", expect.objectContaining({ method: "POST" })),
    );
  });

  it("keeps the draft and names the conflict on 409", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response("dup", { status: 409 })
        : jsonOnce(TAGS),
    );
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.change(screen.getByLabelText("Tag name"), { target: { value: "Holiday" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A tag with this name already exists.");
    expect(screen.getByLabelText("Tag name")).toHaveValue("Holiday");
  });

  it("explains a 404 on create as a sentence, not the raw translation key", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "POST"
        ? new Response("gone", { status: 404 })
        : jsonOnce(TAGS),
    );
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.change(screen.getByLabelText("Tag name"), { target: { value: "Trip" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This tag no longer exists. Refresh the page.",
    );
  });

  it("renames in place: the chip becomes an input, Escape cancels and sends nothing", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Modify Holiday" }));
    const input = screen.getByDisplayValue("Holiday");
    fireEvent.change(input, { target: { value: "Vacation" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("Vacation")).toBeNull();
    expect(screen.getAllByTestId("tag-chip")[0]).toHaveTextContent("Holiday");
    expect(vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method)).toHaveLength(0);
  });

  it("sends the full body on a rename, keeping the current colour", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Modify Holiday" }));
    fireEvent.change(screen.getByDisplayValue("Holiday"), { target: { value: " Vacation " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/tags/t1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Vacation", color: "#5b9bf0" }),
        }),
      ),
    );
  });

  it("keeps the draft mounted when a rename fails", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("boom", { status: 500 })
        : jsonOnce(TAGS),
    );
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Modify Holiday" }));
    fireEvent.change(screen.getByDisplayValue("Holiday"), { target: { value: "Vacation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That tag could not be saved.");
    expect(screen.getByDisplayValue("Vacation")).toBeVisible();
  });

  it("explains a 404 on rename (TagRow) as a sentence, not the raw translation key", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Response("gone", { status: 404 })
        : jsonOnce(TAGS),
    );
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Modify Holiday" }));
    fireEvent.change(screen.getByDisplayValue("Holiday"), { target: { value: "Vacation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This tag no longer exists. Refresh the page.",
    );
  });

  it("changes a colour without renaming, and clears it with null", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Colour of Holiday" }));
    expect(vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Colour #4dd0b1" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/tags/t1",
        expect.objectContaining({ body: JSON.stringify({ name: "Holiday", color: "#4dd0b1" }) }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Colour of Holiday" }));
    fireEvent.click(screen.getByRole("button", { name: "No colour" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/tags/t1",
        expect.objectContaining({ body: JSON.stringify({ name: "Holiday", color: null }) }),
      ),
    );
  });

  it("disables one row's controls while that row has a write in flight", async () => {
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH"
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : jsonOnce(TAGS),
    );
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Modify Holiday" }));
    fireEvent.change(screen.getByDisplayValue("Holiday"), { target: { value: "Vacation" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Delete Holiday" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Modify Work" })).toBeEnabled();
    resolve(jsonOnce({ id: "t1", name: "Vacation", color: "#5b9bf0", txCount: 4 }));
  });

  it("deletes only after confirmation, and survives a failed delete", async () => {
    renderSurface();
    await screen.findByText("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Delete Holiday" }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Delete tag");
    expect(screen.getByText(/removed from 4 transactions/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "DELETE"),
    ).toHaveLength(0);

    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "DELETE"
        ? new Response("no", { status: 500 })
        : jsonOnce(TAGS),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete Holiday" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/budget/tags/t1", expect.objectContaining({ method: "DELETE" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("That tag could not be deleted.");
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("has its own loading, error-with-retry and empty states", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("no", { status: 500 }));
    renderSurface();
    const retry = await screen.findByRole("button", { name: /retry|réessayer/i });
    vi.mocked(fetch).mockImplementation(async () => jsonOnce([]));
    fireEvent.click(retry);
    expect(await screen.findByText(/No tags yet\./)).toBeVisible();
  });
});
