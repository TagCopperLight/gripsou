import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PREFS, getPrefs, setPrefs } from "./prefs";

describe("prefs singleton", () => {
  afterEach(() => setPrefs(DEFAULT_PREFS));

  it("starts at defaults", () => {
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.numberGroupSep).toBe(" ");
    expect(DEFAULT_PREFS.currency).toBe("EUR");
  });

  it("setPrefs replaces the current prefs", () => {
    setPrefs({ ...DEFAULT_PREFS, uiLanguage: "fr", currency: "USD" });
    expect(getPrefs().uiLanguage).toBe("fr");
    expect(getPrefs().currency).toBe("USD");
  });
});
