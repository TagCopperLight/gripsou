// MOCKUP ONLY — invented accounts, holdings and figures, standing in for the
// API until the backend exists. The shapes are the ones the page is drawn
// from, so swapping this for a hook should not touch the components.

import type { ExposureHolding } from "../../lib/exposure";

export type ReturnFigures = {
  /** Money-weighted return per year as a ratio (0.084 = +8.4 %/yr), or null
   *  when no holding in scope has its purchases recorded. */
  annualised: number | null;
  /** Date of the first purchase the return covers. */
  since: string | null;
  invested: string;
  value: string;
  gl: string;
  glPct: string;
};

export type MissingPurchases = { id: string; name: string };

export type ReturnAccount = ReturnFigures & {
  id: string;
  name: string;
  color: string;
  /** The bank or broker the account comes from. */
  source: string;
  /** Holdings whose recorded purchases don't explain the quantity held, left
   *  out of `annualised`. */
  missing: MissingPurchases[];
};

export type InvestmentsData = {
  today: string;
  total: ReturnFigures;
  accounts: ReturnAccount[];
  holdings: ExposureHolding[];
};

/** "offline": the API can't be reached. */
export type Scenario = "full" | "partial" | "empty" | "offline";
export const SCENARIOS: Scenario[] = ["full", "partial", "empty", "offline"];

const w = (pairs: [string, number][]) => pairs.map(([name, weight]) => ({ name, weight }));

const WORLD = {
  countries: w([
    ["Etats-Unis", 0.7], ["Japon", 0.055], ["Royaume-Uni", 0.04], ["Canada", 0.03],
    ["France", 0.03], ["Suisse", 0.025], ["Allemagne", 0.022], ["Australie", 0.018],
    ["Pays-Bas", 0.012],
  ]),
  sectors: w([
    ["Technologie", 0.25], ["Services financiers", 0.16], ["Industriels", 0.11],
    ["Santé", 0.1], ["Biens de consommation cyclique", 0.1], ["Services de communication", 0.08],
    ["Biens de consommation défensif", 0.06], ["Énergie", 0.04],
    ["Matières premières de base", 0.035], ["Services publics", 0.025],
  ]),
};

const holdings: ExposureHolding[] = [
  { key: "WLD", name: "World Equity ETF", value: 5200, composition: WORLD },
  {
    key: "USL", name: "US Large Cap ETF", value: 3100,
    composition: {
      countries: w([["Etats-Unis", 0.995]]),
      sectors: w([
        ["Technologie", 0.32], ["Services financiers", 0.13], ["Santé", 0.1],
        ["Biens de consommation cyclique", 0.1], ["Services de communication", 0.09],
        ["Industriels", 0.08], ["Biens de consommation défensif", 0.06], ["Énergie", 0.035],
        ["Services publics", 0.025], ["Matières premières de base", 0.02], ["Immobilier", 0.02],
      ]),
    },
  },
  {
    key: "T100", name: "Tech 100 ETF", value: 1800,
    composition: {
      countries: w([["Etats-Unis", 0.975], ["Pays-Bas", 0.01], ["Canada", 0.008]]),
      sectors: w([
        ["Technologie", 0.59], ["Services de communication", 0.14],
        ["Biens de consommation cyclique", 0.11], ["Biens de consommation défensif", 0.06],
        ["Santé", 0.04], ["Industriels", 0.03], ["Services publics", 0.01],
        ["Matières premières de base", 0.01], ["Énergie", 0.005], ["Services financiers", 0.005],
      ]),
    },
  },
  {
    key: "EU600", name: "Europe 600 ETF", value: 1050,
    composition: {
      countries: w([
        ["Royaume-Uni", 0.23], ["France", 0.17], ["Suisse", 0.15], ["Allemagne", 0.14],
        ["Pays-Bas", 0.07], ["Suède", 0.05], ["Danemark", 0.04], ["Italie", 0.04], ["Espagne", 0.04],
      ]),
      sectors: w([
        ["Services financiers", 0.2], ["Industriels", 0.17], ["Santé", 0.15],
        ["Biens de consommation défensif", 0.1], ["Biens de consommation cyclique", 0.09],
        ["Technologie", 0.07], ["Matières premières de base", 0.06], ["Énergie", 0.05],
        ["Services de communication", 0.04], ["Services publics", 0.04],
      ]),
    },
  },
  // Same fund in a second account: one slice in "by holding".
  { key: "WLD", name: "World Equity ETF", value: 1200, composition: WORLD },
  {
    key: "EM", name: "Emerging Markets ETF", value: 750,
    composition: {
      countries: w([
        ["Chine", 0.27], ["Inde", 0.2], ["Taïwan", 0.19], ["Corée du Sud", 0.1],
        ["Brésil", 0.05], ["Arabie Saoudite", 0.04], ["Afrique du Sud", 0.03], ["Mexique", 0.02],
      ]),
      sectors: w([
        ["Technologie", 0.23], ["Services financiers", 0.22], ["Biens de consommation cyclique", 0.13],
        ["Services de communication", 0.09], ["Matières premières de base", 0.07],
        ["Industriels", 0.07], ["Énergie", 0.05], ["Biens de consommation défensif", 0.05],
        ["Santé", 0.04], ["Services publics", 0.03],
      ]),
    },
  },
];

const PEA: ReturnAccount = {
  id: "pea", name: "PEA", color: "#5b9bf0", source: "Northbank",
  annualised: 0.084, since: "2024-12-08",
  invested: "9700", value: "11150", gl: "1450", glPct: "0.1495", missing: [],
};

const CTO: ReturnAccount = {
  id: "cto", name: "Securities account", color: "#4dd0b1", source: "Lumen Broker",
  annualised: -0.031, since: "2026-03-02",
  invested: "2000", value: "1950", gl: "-50", glPct: "-0.025", missing: [],
};

const FULL: InvestmentsData = {
  today: "2026-10-08",
  total: {
    annualised: 0.071, since: "2024-12-08",
    invested: "11700", value: "13100", gl: "1400", glPct: "0.1197",
  },
  accounts: [PEA, CTO],
  holdings,
};

// A stock with neither purchases nor composition data, in an account that
// otherwise has a return; and an account where nothing has purchases yet.
const ACME = { id: "acme", name: "Acme Corp" };
const GLOBEX = { id: "globex", name: "Globex" };

const PARTIAL: InvestmentsData = {
  today: "2026-10-08",
  total: {
    annualised: 0.071, since: "2024-12-08",
    invested: "12400", value: "13800", gl: "1400", glPct: "0.1129",
  },
  accounts: [
    PEA,
    { ...CTO, invested: "2400", value: "2350", gl: "-50", glPct: "-0.0208", missing: [ACME] },
    {
      id: "old", name: "Old brokerage", color: "#b07ef0", source: "Northbank",
      annualised: null, since: null,
      invested: "300", value: "300", gl: "0", glPct: "0", missing: [GLOBEX],
    },
  ],
  holdings: [
    ...holdings,
    { key: "ACME", name: "Acme Corp", value: 400, composition: null },
    { key: "GLBX", name: "Globex", value: 300, composition: null },
  ],
};

export function mockInvestments(s: Scenario): InvestmentsData | null {
  if (s === "full") return FULL;
  if (s === "partial") return PARTIAL;
  return null;
}
