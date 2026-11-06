import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsServer } from "./Server";
import type { Provider } from "../../../api/types";
import { renderWithApp, jsonResponse, stubFetch } from "../../../test/kit";

const PROVIDERS: Provider[] = [
  { key: "powens", displayName: "Powens", description: "Bank aggregation.", enabled: true },
];

// The Budget AI blocks read their own settings and usage; every stub answers
// them the same way.
const budgetAiRes = (url: string) =>
  jsonResponse(url.endsWith("/usage")
        ? { currency: "USD", models: [], totalCost: "0" }
        : { provider: null, model: null, available: [], defaults: { jev: "j" } });

describe("SettingsServer — data providers", () => {
  beforeEach(() => {
    stubFetch(async (url: string, init?: RequestInit) => {
        if (url.includes("/settings/budget-ai")) return budgetAiRes(url);
        if (url.includes("/settings/api-keys")) return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
        return jsonResponse(init?.method === "PATCH" ? { ...PROVIDERS[0], enabled: false } : PROVIDERS);
      });
  });

  it("PATCHes the provider when its toggle is flipped", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    renderWithApp(<SettingsServer />);
    await screen.findByText("Powens");
    fireEvent.click(screen.getByRole("switch", { name: "Powens" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/providers/powens",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ enabled: false }) }),
      ),
    );
  });
});
