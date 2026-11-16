import type { TFunction } from "i18next";

// Boursorama labels countries in French. Common ones map to ISO alpha-2 for
// Intl.DisplayNames; the rest show the raw name.
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

export function countryCode(name: string): string | null {
  return COUNTRY_CODE[name] ?? null;
}

export function localizeCountry(name: string, lang: string): string {
  const code = COUNTRY_CODE[name];
  if (!code) return name;
  return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? name;
}

// Sectors have no Intl equivalent: translated via i18n keyed on the French name.
export function localizeSector(name: string, t: TFunction): string {
  return t(`sectors.${name}`, { defaultValue: name });
}
