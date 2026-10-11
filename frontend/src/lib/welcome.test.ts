import { describe, it, expect } from "vitest";
import { browserPrefs, prefillFromBrowser } from "./welcome";
import { DEFAULT_PREFS } from "./prefs";

describe("browserPrefs", () => {
  it("picks French when French is the first supported language", () => {
    expect(browserPrefs(["de-DE", "fr-FR", "en"], "Europe/Paris").uiLanguage).toBe("fr");
  });
  it("picks English when English comes first", () => {
    expect(browserPrefs(["en-GB", "fr"], "Europe/London").uiLanguage).toBe("en");
  });
  it("falls back to English when neither is listed", () => {
    expect(browserPrefs(["de-DE"], "Europe/Berlin").uiLanguage).toBe("en");
  });
  it("uses the browser time zone, or Europe/Paris when it has none", () => {
    expect(browserPrefs(["en"], "America/New_York").timeZone).toBe("America/New_York");
    expect(browserPrefs(["en"], "").timeZone).toBe("Europe/Paris");
  });
});

describe("prefillFromBrowser", () => {
  const detected = { uiLanguage: "fr" as const, timeZone: "America/Montreal" };
  it("replaces language and time zone still at their defaults", () => {
    const next = prefillFromBrowser(DEFAULT_PREFS, detected);
    expect(next.uiLanguage).toBe("fr");
    expect(next.timeZone).toBe("America/Montreal");
    expect(next.currency).toBe("EUR");
  });
  it("keeps a choice the user already made", () => {
    const next = prefillFromBrowser({ ...DEFAULT_PREFS, timeZone: "Asia/Tokyo" }, detected);
    expect(next.timeZone).toBe("Asia/Tokyo");
  });
});
