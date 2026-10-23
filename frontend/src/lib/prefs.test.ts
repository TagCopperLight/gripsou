import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_PREFS, getPrefs, setPrefs, withPatch } from "./prefs";

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

describe("withPatch", () => {
  it("changes only the settings in the patch", () => {
    expect(withPatch(DEFAULT_PREFS, { currency: "USD" })).toEqual({ ...DEFAULT_PREFS, currency: "USD" });
  });

  it("removes the avatar on null", () => {
    expect(withPatch({ ...DEFAULT_PREFS, avatar: "data:image/webp;base64,A" }, { avatar: null })).toEqual(DEFAULT_PREFS);
  });
});
