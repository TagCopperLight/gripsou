// Which index a fund tracks, read from its name: ETF names carry their index
// almost always, while the providers we scrape name it for few funds and only
// in raw form ("MSCI DAILY NET TR W").

// Matched against the name upper-cased, punctuation (but &) turned to spaces.
// More specific indices come first: ACWI before World.
const INDICES: [string, RegExp][] = [
  ["MSCI ACWI", /\bMSCI (ACWI|ALL COUNTRY WORLD)\b/],
  ["MSCI World", /\bMSCI WORLD\b/],
  ["MSCI Emerging Markets", /\bMSCI EMERGING MARKETS?\b/],
  ["MSCI Europe", /\bMSCI EUROPE\b/],
  ["MSCI USA", /\bMSCI USA\b/],
  ["MSCI Japan", /\bMSCI JAPAN\b/],
  ["S&P 500", /\bS&P ?500\b/],
  ["Nasdaq-100", /\bNASDAQ ?100\b/],
  ["Stoxx Europe 600", /\bSTOXX EUROPE 600\b/],
  ["Euro Stoxx 50", /\bEURO STOXX 50\b/],
  ["CAC 40", /\bCAC ?40\b/],
];

// A word right after the index that makes it a narrower one (MSCI World
// Small Cap, S&P 500 Equal Weight): such a fund is not the broad index.
const NARROWER =
  /^ (SMALL|MID|EX|MOMENTUM|QUALITY|VALUE|GROWTH|MIN|MINIMUM|EQUAL|SRI|ESG|CLIMATE|ISLAMIC|DIVIDEND|HIGH)\b/;

/** The index `name` tracks, or null when it names none we know. */
export function trackedIndex(name: string): string | null {
  const text = name.toUpperCase().replace(/[^A-Z0-9&]+/g, " ");
  for (const [index, pattern] of INDICES) {
    const m = pattern.exec(text);
    if (m) return NARROWER.test(text.slice(m.index + m[0].length)) ? null : index;
  }
  return null;
}
