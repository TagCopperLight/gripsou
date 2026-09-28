import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ListPrefsSurface } from "./ListPrefsSurface";
import { AuthContext, type AuthValue } from "../../auth/context";
import { DEFAULT_PREFS, type UserPrefs } from "../../lib/prefs";

function renderWith(prefs: UserPrefs, updatePrefs = vi.fn()) {
  const value = { prefs, updatePrefs } as unknown as AuthValue;
  render(
    <AuthContext.Provider value={value}>
      <ListPrefsSurface />
    </AuthContext.Provider>,
  );
  return { updatePrefs };
}

describe("ListPrefsSurface", () => {
  it("reflects the stored preference", () => {
    renderWith({ ...DEFAULT_PREFS, showChecked: true });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("writes the whole prefs object with the flipped flag", () => {
    const { updatePrefs } = renderWith({ ...DEFAULT_PREFS, showChecked: false });
    fireEvent.click(screen.getByRole("switch"));
    expect(updatePrefs).toHaveBeenCalledWith(
      expect.objectContaining({ ...DEFAULT_PREFS, showChecked: true }),
    );
  });
});
