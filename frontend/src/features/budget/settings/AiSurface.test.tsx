import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { AiSurface } from "./AiSurface";
import { DEFAULT_PREFS, type UserPrefs } from "../../../api/wire";
import { authValue, renderWithApp, stubFetch, testUser } from "../../../test/kit";

function renderWith(prefs: UserPrefs, configured: boolean) {
  stubFetch(async () =>
    Response.json({ configured, enabled: configured && prefs.budgetAiEnabled, running: false, remaining: 0,
      reviewCount: 0, threshold: prefs.budgetAiThreshold, lastRun: null }));
  const updatePrefs = vi.fn(async () => {});
  renderWithApp(<AiSurface />, { auth: authValue({ prefs, updatePrefs }) });
  return { updatePrefs };
}

afterEach(() => vi.unstubAllGlobals());

describe("AiSurface", () => {
  it("turns the AI on", async () => {
    const { updatePrefs } = renderWith(DEFAULT_PREFS, true);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    expect(updatePrefs).toHaveBeenCalledWith({ budgetAiEnabled: true });
  });

  it("moves the threshold in steps of five", async () => {
    const { updatePrefs } = renderWith({ ...DEFAULT_PREFS, budgetAiEnabled: true }, true);
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: "65" } });
    fireEvent.pointerUp(slider);
    expect(updatePrefs).toHaveBeenCalledWith({ budgetAiThreshold: 65 });
  });

  it("offers a set-up to an admin when the server has no provider, and only to an admin", async () => {
    const status = { configured: false, enabled: false, running: false, remaining: 0, reviewCount: 0, threshold: 70, lastRun: null };
    stubFetch(async () => Response.json(status));
    const admin = renderWithApp(<AiSurface />, { auth: authValue({ user: testUser({ role: "admin" }) }) });
    expect(await screen.findByText("No AI provider set up")).toBeVisible();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByRole("button", { name: "Set up" })).toBeVisible();
    admin.unmount();

    renderWithApp(<AiSurface />, { auth: authValue({ prefs: DEFAULT_PREFS }) });
    expect(await screen.findByText("No AI provider set up")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Set up" })).toBeNull();
  });

  it("doesn't claim there is no provider before the server has answered", async () => {
    stubFetch(() => new Promise<Response>(() => {}));
    renderWithApp(<AiSurface />, { auth: authValue({ prefs: DEFAULT_PREFS }) });
    expect(await screen.findByText("Loading…")).toBeVisible();
    expect(screen.queryByText("No AI provider set up")).toBeNull();
  });

  it("offers a retry, not the no-provider message, when the status can't be loaded", async () => {
    stubFetch(async () => new Response(null, { status: 500 }));
    renderWithApp(<AiSurface />, { auth: authValue({ prefs: DEFAULT_PREFS }) });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
    expect(screen.queryByText("No AI provider set up")).toBeNull();
  });
});
