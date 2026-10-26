import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SettingsServer } from "./Server";
import type { Provider } from "../../api/types";

const PROVIDERS: Provider[] = [
  { key: "powens", displayName: "Powens", description: "Bank aggregation.", enabled: true },
];

// The Budget AI blocks read their own settings and usage; every stub answers
// them the same way.
const budgetAiRes = (url: string) =>
  new Response(
    JSON.stringify(
      url.endsWith("/usage")
        ? { currency: "USD", models: [], totalCost: "0" }
        : { provider: null, model: null, available: [], defaults: { jev: "j" } },
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

function withClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("SettingsServer — data providers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/settings/budget-ai")) return budgetAiRes(url);
        return new Response(
          JSON.stringify(init?.method === "PATCH" ? { ...PROVIDERS[0], enabled: false } : PROVIDERS),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
  });

  it("PATCHes the provider when its toggle is flipped", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    render(withClient(<SettingsServer />));
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
