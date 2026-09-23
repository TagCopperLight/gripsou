import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AiBanner } from "./AiBanner";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

function stub(status: object) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { calls.push(String(url)); return new Response(null, { status: 202 }); }
    return Response.json({ configured: true, enabled: true, running: false, remaining: 0, reviewCount: 0,
      threshold: 80, lastRun: null, ...status });
  }));
  return calls;
}

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AiBanner /></QueryClientProvider>);
}

afterEach(() => vi.unstubAllGlobals());

describe("AiBanner", () => {
  it("leads to Review mode", async () => {
    stub({ reviewCount: 5 });
    renderBanner();
    expect(await screen.findByText("5 transactions need review")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Review 5/ }));
    expect(navigate).toHaveBeenCalledWith({ to: "/budget/review" });
  });

  it("shows the failure and retries", async () => {
    const calls = stub({ lastRun: { outcome: "error", error: "API key not valid", at: 0 } });
    renderBanner();
    expect(await screen.findByText("API key not valid")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls[0]).toContain("/budget/categorize"));
  });

  it("shows progress while running", async () => {
    stub({ running: true, remaining: 40 });
    renderBanner();
    expect(await screen.findByText("Categorising your history — 40 left")).toBeVisible();
  });

  it("renders nothing when idle", async () => {
    stub({});
    const { container } = renderBanner();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
