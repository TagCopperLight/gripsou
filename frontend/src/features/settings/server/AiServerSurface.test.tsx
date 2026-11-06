import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { AiServerSurface } from "./AiServerSurface";
import { renderWithApp, stubFetch } from "../../../test/kit";

function stub(available: string[]) {
  const patches: unknown[] = [];
  stubFetch(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { patches.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
    return Response.json({ provider: null, model: null, available, defaults: { jev: "jev-latest" } });
  });
  return patches;
}

afterEach(() => vi.unstubAllGlobals());

describe("AiServerSurface", () => {
  it("hides a provider whose key is not set", async () => {
    stub([]);
    renderWithApp(<AiServerSurface />);
    expect(await screen.findByRole("radio", { name: "off" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("radio", { name: "jev" })).toBeNull();
  });

  it("offers a provider whose key is set, and pre-fills the model", async () => {
    const patches = stub(["jev"]);
    renderWithApp(<AiServerSurface />);
    // Every choice is a visible radio segment.
    fireEvent.click(await screen.findByRole("radio", { name: "jev" }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "jev", model: "jev-latest" }));
  });

  it("lists the provider's models, keeps the saved one, and saves a pick", async () => {
    const patches: unknown[] = [];
    let settings = { provider: "jev", model: "jev-retired", available: ["jev"],
      defaults: { jev: "jev-latest" } };
    stubFetch(async (url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        settings = { ...settings, ...body };
        return new Response(null, { status: 204 });
      }
      if (url.endsWith("/settings/budget-ai/models/jev")) {
        return Response.json(["jev-2", "jev-latest"]);
      }
      return Response.json(settings);
    });
    renderWithApp(<AiServerSurface />);
    const model = await screen.findByLabelText("Model");
    await waitFor(() => expect(model).toBeEnabled());
    expect(model).toHaveTextContent("jev-retired");

    fireEvent.click(model);
    // The provider doesn't offer the saved model, but it stays listed beside the others.
    expect(screen.getByRole("button", { name: "jev-retired" })).toBeVisible();
    expect(screen.getByRole("button", { name: "jev-latest" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "jev-2" }));
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "jev", model: "jev-2" }));
    await waitFor(() => expect(model).toHaveTextContent("jev-2"));
    expect(screen.queryByText(/could not be loaded/)).toBeNull();
  });

  it("falls back to typing, and shows the default once a model is cleared", async () => {
    const patches: unknown[] = [];
    let settings = { provider: "jev", model: "custom-model", available: ["jev"],
      defaults: { jev: "jev-latest" } };
    stubFetch(async (url: string, init?: RequestInit) => {
      if (url.includes("/models/")) return new Response("bad gateway", { status: 502 });
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        patches.push(body);
        settings = { ...settings, ...body };
        return new Response(null, { status: 204 });
      }
      return Response.json(settings);
    });
    renderWithApp(<AiServerSurface />);
    expect(await screen.findByText(/could not be loaded/)).toBeVisible();
    const model = screen.getByLabelText("Model");
    expect(model).toHaveValue("custom-model");

    fireEvent.change(model, { target: { value: "  " } });
    fireEvent.blur(model);
    await waitFor(() => expect(patches.at(-1)).toEqual({ provider: "jev", model: null }));
    await waitFor(() => expect(model).toHaveValue("jev-latest"));
  });

  it("offers a retry instead of vanishing when the settings cannot be loaded", async () => {
    stubFetch(async () => new Response("down", { status: 500 }));
    renderWithApp(<AiServerSurface />);
    expect(screen.getByText("AI categorisation")).toBeVisible();
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  });
});
