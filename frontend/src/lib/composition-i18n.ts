import type { TFunction } from "i18next";

// Boursorama labels countries in French. Map the common ETF-holding countries
// to ISO-3166 alpha-2 so Intl.DisplayNames can localize into any UI language;
// the long tail falls back to the raw French name.
// ponytail: hand-maintained common set + raw fallback. Grow only if a country
// people actually hold keeps showing up in French.
const COUNTRY_CODE: Record<string, string> = {
  "Etats-Unis": "US",
  Canada: "CA",
  "Pays-Bas": "NL",
  "Royaume-Uni": "GB",
  France: "FR",
  Allemagne: "DE",
  Suisse: "CH",
  Japon: "JP",
  Chine: "CN",
  "Corée du Sud": "KR",
  Taïwan: "TW",
  Inde: "IN",
  Australie: "AU",
  "Hong Kong": "HK",
  Brésil: "BR",
  Italie: "IT",
  Espagne: "ES",
  Suède: "SE",
  Danemark: "DK",
  Irlande: "IE",
  Finlande: "FI",
  Norvège: "NO",
  Belgique: "BE",
  Autriche: "AT",
  Portugal: "PT",
  Singapour: "SG",
  "Afrique du Sud": "ZA",
  Mexique: "MX",
  "Nouvelle-Zélande": "NZ",
  Israël: "IL",
  Luxembourg: "LU",
  Pologne: "PL",
  Indonésie: "ID",
  Thaïlande: "TH",
  Malaisie: "MY",
  Turquie: "TR",
  "Arabie Saoudite": "SA",
};

/// French country name (from Boursorama) → name in the given UI language, via
/// the native Intl.DisplayNames. Unmapped countries pass through unchanged.
export function localizeCountry(name: string, lang: string): string {
  const code = COUNTRY_CODE[name];
  if (!code) return name;
  return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? name;
}

/// Sectors have no Intl equivalent: translate via i18n keyed on the French
/// source string (fr is identity), falling back to the raw name.
export function localizeSector(name: string, t: TFunction): string {
  return t(`sectors.${name}`, { defaultValue: name });
}
