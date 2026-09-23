import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { BudgetAiServerSurface } from "./BudgetAiServerSurface";

function stub() {
  const patches: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
    return Response.json({ provider: null, model: null, available: ["gemini"],
      defaults: { gemini: "gemini-3.5-flash-lite", jev: "jev-latest" } });
  }));
  return patches;
}

afterEach(() => vi.unstubAllGlobals());

describe("BudgetAiServerSurface", () => {
  it("offers only providers whose key is set, and pre-fills the model", async () => {
    const patches = stub();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><BudgetAiServerSurface /></QueryClientProvider>);
    await screen.findByText("Budget AI");
    // Every choice is a visible radio segment; a provider without a key is absent.
    expect(screen.getByRole("radio", { name: "off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radio", { name: "jev" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "gemini" }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite" }));
  });
});
