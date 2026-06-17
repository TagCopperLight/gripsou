import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PREFS, getPrefs, setPrefs } from "./prefs";

describe("prefs singleton", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("starts at defaults", () => {
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.numberGroupSep).toBe(" ");
    expect(DEFAULT_PREFS.currencySymbol).toBe("€");
  });

  it("setPrefs replaces the current prefs", () => {
    setPrefs({ ...DEFAULT_PREFS, uiLanguage: "fr", currencySymbol: "$" });
    expect(getPrefs().uiLanguage).toBe("fr");
    expect(getPrefs().currencySymbol).toBe("$");
  });
});
