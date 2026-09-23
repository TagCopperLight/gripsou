import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AiSurface } from "./AiSurface";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS, type UserPrefs } from "../../lib/prefs";

function renderWith(prefs: UserPrefs, configured: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () =>
    Response.json({ configured, enabled: configured && prefs.budgetAiEnabled, running: false, remaining: 0,
      reviewCount: 0, threshold: prefs.budgetAiThreshold, lastRun: null })));
  const updatePrefs = vi.fn(async () => {});
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AuthContext.Provider value={{ prefs, updatePrefs } as unknown as AuthValue}>
        <AiSurface />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { updatePrefs };
}

afterEach(() => vi.unstubAllGlobals());

describe("AiSurface", () => {
  it("turns the AI on", async () => {
    const { updatePrefs } = renderWith(DEFAULT_PREFS, true);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).not.toBeDisabled());
    fireEvent.click(toggle);
    expect(updatePrefs).toHaveBeenCalledWith(expect.objectContaining({ budgetAiEnabled: true }));
  });

  it("moves the threshold in steps of five", async () => {
    const { updatePrefs } = renderWith({ ...DEFAULT_PREFS, budgetAiEnabled: true }, true);
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: "65" } });
    fireEvent.pointerUp(slider);
    expect(updatePrefs).toHaveBeenCalledWith(expect.objectContaining({ budgetAiThreshold: 65 }));
  });

  it("is disabled with an explanation when the server has no provider", async () => {
    renderWith(DEFAULT_PREFS, false);
    expect(await screen.findByText("Ask your administrator to configure an AI provider.")).toBeVisible();
    expect(screen.getByRole("switch")).toBeDisabled();
  });
});
