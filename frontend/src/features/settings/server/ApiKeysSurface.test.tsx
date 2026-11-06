import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ApiKeysSurface } from "./ApiKeysSurface";
import type { ApiKeyProvider } from "../../../api/types";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

const KEYS: ApiKeyProvider[] = [
  {
    key: "powens",
    displayName: "Powens",
    fields: [
      { key: "client_id", label: "Client ID", secret: false, value: "id-1" },
      { key: "client_secret", label: "Client secret", secret: true, set: true },
    ],
  },
];

const patches = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([, init]) => init?.method === "PATCH");

function renderCard() {
  renderWithApp(<ApiKeysSurface />);
}

beforeEach(() => {
  stubFetch(async (_url: string, init?: RequestInit) => jsonResponse(init?.method === "PATCH" ? KEYS[0] : KEYS));
});

describe("ApiKeysSurface — secret", () => {
  it("sends nothing when the new key is typed and the field is left", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    const input = screen.getByLabelText("Client secret");
    fireEvent.change(input, { target: { value: "new-secret" } });
    fireEvent.blur(input);
    expect(patches()).toHaveLength(0);
  });

  it("sends nothing when the new key is typed and Escape is pressed", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    const input = screen.getByLabelText("Client secret");
    fireEvent.change(input, { target: { value: "new-secret" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(patches()).toHaveLength(0);
  });

  it("sends the trimmed key on Enter", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    const input = screen.getByLabelText("Client secret");
    fireEvent.change(input, { target: { value: " new-secret " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0][0]).toBe("/api/settings/api-keys/powens");
    expect(patches()[0][1].body).toBe(JSON.stringify({ field: "client_secret", value: "new-secret" }));
  });
});

describe("ApiKeysSurface — plain field", () => {
  it("removes the value when emptied and left, and sends nothing on Escape", async () => {
    renderCard();
    const input = await screen.findByLabelText("Client ID");
    fireEvent.change(input, { target: { value: "changed" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await new Promise((r) => requestAnimationFrame(r));
    expect(patches()).toHaveLength(0);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0][1].body).toBe(JSON.stringify({ field: "client_id", value: null }));
  });
});
