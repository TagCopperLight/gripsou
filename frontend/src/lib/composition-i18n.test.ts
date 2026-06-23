import { describe, it, expect } from "vitest";
import i18n from "../i18n";
import { localizeCountry, localizeSector } from "./composition-i18n";

describe("composition-i18n", () => {
  it("localizes mapped countries via Intl", () => {
    expect(localizeCountry("Etats-Unis", "en")).toBe("United States");
    expect(localizeCountry("Pays-Bas", "en")).toBe("Netherlands");
    expect(localizeCountry("Etats-Unis", "fr")).toBe("États-Unis");
  });

  it("passes unmapped countries through unchanged", () => {
    expect(localizeCountry("Atlantide", "en")).toBe("Atlantide");
  });

  it("translates sectors and falls back to the raw name", () => {
    expect(localizeSector("Technologie", i18n.t)).toBe("Technology");
    expect(localizeSector("Inconnu", i18n.t)).toBe("Inconnu");
  });
});
