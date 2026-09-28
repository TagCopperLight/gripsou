import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AiCostSurface } from "./AiCostSurface";
import { formatMoney } from "../../lib/money";
import type { BudgetAiUsage } from "../../api/budget";

const USAGE: BudgetAiUsage = {
  currency: "USD",
  models: [
    { model: "jev:jev-latest", runs: 3, runsWithoutUsage: 0, tokensIn: 9495459, tokensOut: 4484808,
      priceIn: "0.042", priceOut: "0", cost: "0.3988" },
    { model: "gemini:gemini-3.5-flash-lite", runs: 2, runsWithoutUsage: 1, tokensIn: 1000, tokensOut: 500,
      priceIn: null, priceOut: null, cost: null },
  ],
  totalCost: "0.3988",
};

function stub(usage: BudgetAiUsage = USAGE) {
  const puts: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PUT" && url === "/api/settings/budget-ai/prices") {
      puts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }
    if (url === "/api/settings/budget-ai/usage") return Response.json(usage);
    return new Response(null, { status: 404 });
  }));
  return puts;
}

function renderSurface() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><AiCostSurface /></QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("AiCostSurface", () => {
  it("renders a row per model and the total", async () => {
    stub();
    renderSurface();
    expect(await screen.findByText("jev:jev-latest")).toBeInTheDocument();
    expect(screen.getByText("gemini:gemini-3.5-flash-lite")).toBeInTheDocument();
    expect(screen.getByTestId("ai-cost-total")).toHaveTextContent(
      formatMoney("0.3988", { currency: "USD", fractionDigits: 2 }),
    );
    expect(screen.getByLabelText("Input price for jev:jev-latest")).toHaveValue("0.042");
  });

  it("marks unpriced models and runs without usage", async () => {
    stub();
    renderSurface();
    await screen.findByText("gemini:gemini-3.5-flash-lite");
    expect(screen.getByText("No price set")).toBeInTheDocument();
    expect(screen.getByText("1 run without usage data (not counted)")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", async () => {
    stub({ currency: "USD", models: [], totalCost: "0" });
    renderSurface();
    expect(await screen.findByText("No AI categorization runs yet.")).toBeInTheDocument();
  });

  it("sends the full price map when a price is edited", async () => {
    const puts = stub();
    renderSurface();
    const input = await screen.findByLabelText("Input price for gemini:gemini-3.5-flash-lite");
    fireEvent.change(input, { target: { value: "0.10" } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(puts.at(-1)).toEqual({
        "jev:jev-latest": { in: "0.042", out: "0" },
        "gemini:gemini-3.5-flash-lite": { in: "0.10", out: "0" },
      }),
    );
  });

  it("ignores unchanged or invalid values", async () => {
    const puts = stub();
    renderSurface();
    const input = await screen.findByLabelText("Output price for jev:jev-latest");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "-1" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    await new Promise((r) => setTimeout(r, 20));
    expect(puts).toEqual([]);
  });

  it("keeps its panel while loading, and offers a retry when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    renderSurface();
    expect(screen.getByText("AI categorization cost")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("says so when a price could not be saved", async () => {
    stub();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if ((init as RequestInit | undefined)?.method === "PUT") return new Response("no", { status: 500 });
      return Response.json(url === "/api/settings/budget-ai/usage" ? USAGE : null);
    });
    renderSurface();
    const input = await screen.findByLabelText("Input price for gemini:gemini-3.5-flash-lite");
    fireEvent.change(input, { target: { value: "0.10" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
  });
});
