import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";

import { TagsSurface } from "./TagsSurface";
import type { BudgetTag } from "../../../api/wire";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

const TAGS: BudgetTag[] = [
  { id: "t1", name: "Holiday", color: "#5b9bf0", txCount: 4 },
  { id: "t2", name: "Work", color: null, txCount: 0 },
];

function renderSurface() {
  return renderWithApp(<TagsSurface />);
}

const writes = (method: string) =>
  vi.mocked(fetch).mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === method);

async function newTag(name: string) {
  renderSurface();
  await screen.findByText("Holiday");
  fireEvent.click(screen.getByRole("button", { name: "Add tag" }));
  const input = within(screen.getByRole("dialog", { name: "New tag" })).getByLabelText("Name");
  fireEvent.change(input, { target: { value: name } });
  return input;
}

describe("TagsSurface", () => {
  beforeEach(() => {
    stubFetch(async () => jsonResponse(TAGS));
  });

  it("creates a trimmed tag, with no colour unless one is picked, and closes the window", async () => {
    await newTag("  Trip  ");
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/tags",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Trip", color: null }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("refuses a blank name", async () => {
    await newTag("   ");
    expect(screen.getByRole("button", { name: "Create tag" })).toBeDisabled();
  });

  it("saves on Enter too", async () => {
    const input = await newTag("Trip");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(writes("POST")).toHaveLength(1));
  });

  it("keeps the window and the name, and names the conflict, on 409", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "POST" ? new Response("dup", { status: 409 }) : jsonResponse(TAGS),
    );
    const input = await newTag("Holiday");
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A tag with this name already exists.");
    expect(input).toHaveValue("Holiday");
  });

  it("explains a 404 as a sentence, not the raw translation key", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "POST" ? new Response("gone", { status: 404 }) : jsonResponse(TAGS),
    );
    await newTag("Trip");
    fireEvent.click(screen.getByRole("button", { name: "Create tag" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This tag no longer existsRefresh the page.");
  });

  it("edits name and colour in one full write, and only once something changed", async () => {
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Modify Holiday" }));
    const dialog = screen.getByRole("dialog", { name: "Edit tag" });
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: " Vacation " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "No colour" }));
    fireEvent.click(save);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/budget/tags/t1",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Vacation", color: null }) }),
      ),
    );
  });

  it("keeps the window open with the edits when a save fails", async () => {
    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "PATCH" ? new Response("boom", { status: 500 }) : jsonResponse(TAGS),
    );
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Modify Holiday" }));
    const dialog = screen.getByRole("dialog", { name: "Edit tag" });
    fireEvent.change(within(dialog).getByLabelText("Name"), { target: { value: "Vacation" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the tag");
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Vacation");
  });

  it("deletes from the window only after confirmation, and survives a failed delete", async () => {
    renderSurface();
    fireEvent.click(await screen.findByRole("button", { name: "Modify Holiday" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit tag" })).getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("dialog", { name: "Delete tag" })).toBeVisible();
    expect(screen.getByText(/removed from 4 transactions/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(writes("DELETE")).toHaveLength(0);

    vi.mocked(fetch).mockImplementation(async (_u, init) =>
      (init as RequestInit | undefined)?.method === "DELETE" ? new Response("no", { status: 500 }) : jsonResponse(TAGS),
    );
    fireEvent.click(screen.getByRole("button", { name: "Modify Holiday" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Edit tag" })).getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete tag" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/budget/tags/t1", expect.objectContaining({ method: "DELETE" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the tag");
    expect(screen.getByRole("dialog", { name: "Delete tag" })).toBeVisible();
  });

  it("has its own loading, error-with-retry and empty states", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("no", { status: 500 }));
    renderSurface();
    const retry = await screen.findByRole("button", { name: /retry|réessayer/i });
    expect(screen.getByRole("button", { name: "Add tag" })).toBeDisabled();
    vi.mocked(fetch).mockImplementation(async () => jsonResponse([]));
    fireEvent.click(retry);
    expect(await screen.findByText("No tags yet.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Add tag" })).toBeEnabled();
  });
});
