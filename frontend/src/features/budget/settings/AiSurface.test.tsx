import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";

import { AiSurface } from "./AiSurface";
import { DEFAULT_PREFS, type UserPrefs } from "../../../api/wire";
import { authValue, renderWithApp, stubFetch } from "../../../test/kit";

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

  it("is disabled with an explanation when the server has no provider", async () => {
    renderWith(DEFAULT_PREFS, false);
    expect(await screen.findByText("Ask your administrator to configure an AI provider.")).toBeVisible();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
