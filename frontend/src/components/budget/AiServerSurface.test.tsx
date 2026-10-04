import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AiServerSurface } from "./AiServerSurface";

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

describe("AiServerSurface", () => {
  it("offers only providers whose key is set, and pre-fills the model", async () => {
    const patches = stub();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AiServerSurface /></QueryClientProvider>);
    // Every choice is a visible radio segment; a provider without a key is absent.
    expect(await screen.findByRole("radio", { name: "off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radio", { name: "jev" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "gemini" }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "gemini", model: "gemini-3.5-flash-lite" }));
  });

  it("lists the provider's models, keeps the saved one, and saves a pick", async () => {
    const patches: unknown[] = [];
    let settings = { provider: "gemini", model: "gemini-retired", available: ["gemini"],
      defaults: { gemini: "gemini-3.5-flash-lite", jev: "jev-latest" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        settings = { ...settings, ...body };
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/settings/budget-ai/models/gemini")) {
        return Response.json(["gemini-3.5-flash", "gemini-3.5-flash-lite"]);
      }
      return Response.json(settings);
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AiServerSurface /></QueryClientProvider>);
    const model = await screen.findByLabelText("Model");
    await waitFor(() => expect(model).toBeEnabled());
    expect(model).toHaveTextContent("gemini-retired");

    fireEvent.click(model);
    // The saved model is no longer offered, but stays listed beside the others.
    expect(screen.getByRole("button", { name: "gemini-retired" })).toBeVisible();
    expect(screen.getByRole("button", { name: "gemini-3.5-flash-lite" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "gemini-3.5-flash" }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "gemini", model: "gemini-3.5-flash" }));
    await waitFor(() => expect(model).toHaveTextContent("gemini-3.5-flash"));
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it("falls back to typing, and shows the default once a model is cleared", async () => {
    const patches: unknown[] = [];
    let settings = { provider: "gemini", model: "custom-model", available: ["gemini"],
      defaults: { gemini: "gemini-3.5-flash-lite", jev: "jev-latest" } };
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/models/")) return new Response("bad gateway", { status: 502 });
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        settings = { ...settings, ...body };
        return new Response(null, { status: 204 });
      }
      return Response.json(settings);
    }));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AiServerSurface /></QueryClientProvider>);
    expect(await screen.findByText(/could not be loaded/)).toBeVisible();
    const model = screen.getByLabelText("Model");
    expect(model).toHaveValue("custom-model");

    fireEvent.change(model, { target: { value: "  " } });
    fireEvent.blur(model);
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "gemini", model: null }));
    await waitFor(() => expect(model).toHaveValue("gemini-3.5-flash-lite"));
  });

  it("offers a retry instead of vanishing when the settings cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 500 })));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><AiServerSurface /></QueryClientProvider>);
    expect(screen.getByText("Budget AI")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  });
});
