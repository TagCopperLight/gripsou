import type { SelectOption } from "../components/Select";

/** The main zones: the big cities, about one per offset, and France's
 *  overseas departments and territories. Not every zone the browser knows:
 *  four hundred names, most of them the same hour, made the list unusable. */
export const TIME_ZONES = [
  "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", "America/Denver",
  "America/Chicago", "America/Mexico_City", "America/New_York", "America/Toronto",
  "America/Bogota", "America/Halifax", "America/Guadeloupe", "America/Martinique",
  "America/Cayenne", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "UTC",
  "Europe/London", "Europe/Lisbon", "Africa/Casablanca", "Europe/Paris", "Europe/Brussels",
  "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Zurich", "Africa/Lagos",
  "Europe/Athens", "Africa/Cairo", "Africa/Johannesburg", "Europe/Istanbul", "Europe/Moscow",
  "Indian/Mayotte", "Asia/Dubai", "Indian/Reunion", "Asia/Karachi", "Asia/Kolkata",
  "Asia/Bangkok", "Asia/Singapore", "Asia/Shanghai", "Asia/Hong_Kong", "Australia/Perth",
  "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Noumea", "Pacific/Auckland",
  "Pacific/Tahiti",
];

/** Cities whose name isn't the zone's own, by language (the zone names are
 *  English, without accents). */
const CITY_NAMES: Record<string, Record<string, string>> = {
  en: {
    "America/Mexico_City": "Mexico City", "America/Sao_Paulo": "São Paulo", "Indian/Reunion": "Réunion",
    "Pacific/Noumea": "Nouméa",
  },
  fr: {
    "America/Mexico_City": "Mexico", "America/Sao_Paulo": "São Paulo", "Europe/London": "Londres",
    "Europe/Lisbon": "Lisbonne", "Europe/Brussels": "Bruxelles", "Europe/Athens": "Athènes",
    "Africa/Cairo": "Le Caire", "Europe/Moscow": "Moscou", "Asia/Dubai": "Dubaï", "Indian/Reunion": "La Réunion",
    "Asia/Kolkata": "Calcutta", "Asia/Singapore": "Singapour", "Asia/Seoul": "Séoul", "Pacific/Noumea": "Nouméa",
  },
};

/** The city a zone is named after, in the reader's language. */
function cityName(zone: string, language: string): string {
  return CITY_NAMES[language]?.[zone] ?? zone.split("/").pop()!.replaceAll("_", " ");
}

/** Minutes ahead of UTC in `zone` at `at`, and how it reads ("UTC+5:30"). */
function offset(zone: string, at: Date): { minutes: number; label: string } {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(name);
  if (!m) return { minutes: 0, label: "UTC" };
  const minutes = (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  return { minutes, label: `UTC${name.slice(3)}` };
}

/** The time zone picker's options, by offset today then name: "Paris
 *  (UTC+1)". The zone already saved is kept even when it isn't one of the
 *  main ones, so the picker never shows a value it doesn't list. */
export function timeZoneOptions(current: string, language = "en", at = new Date()): SelectOption[] {
  return [...new Set([...TIME_ZONES, current])]
    .map((zone) => {
      const o = offset(zone, at);
      const city = zone === "UTC" ? "UTC" : cityName(zone, language);
      return { value: zone, label: zone === "UTC" ? "UTC" : `${city} (${o.label})`, minutes: o.minutes, city };
    })
    .sort((a, b) => a.minutes - b.minutes || a.city.localeCompare(b.city, language))
    .map(({ value, label }) => ({ value, label }));
}
