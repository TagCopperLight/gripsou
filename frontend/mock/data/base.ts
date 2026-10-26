// The base dataset: one healthy household. A checking account and a Livret A
// at a bank, a PEA at a broker holding two ETFs bought monthly, a year of
// everyday spending with transfer pairs, the seeded categories, three tags.
// Everything is generated from a fixed seed, anchored on today.

import type { BudgetCategory, BudgetTag } from "../../src/api/budget";
import type {
  Account,
  Composition,
  Lot,
  MfaStatus,
  Provider,
  Session,
  SessionUser,
  SyncConnection,
  User,
} from "../../src/api/types";
import { DEFAULT_PREFS } from "../../src/lib/prefs";
import { DAY_MS, TODAY, daysAgo, id, isoDay, money, rng } from "./util";

/** A ledger or lot row as stored; the API view joins the category and account. */
export type TxnRow = {
  id: string;
  t: number;
  type: string;
  description: string | null;
  amount: number;
  accountId: string;
  source: "cash" | "lot";
  holdingId: string | null;
  quantity: number | null;
  unitPrice: number | null;
  fee: number | null;
  categoryId: string | null;
  categorySource: "user" | "ai" | "pair" | null;
  categoryConfidence: string | null;
  needsReview: boolean;
  checked: boolean;
  isTransfer: boolean;
  isOrphanTransfer: boolean;
  tagIds: string[];
};

export type CategoryRow = Omit<BudgetCategory, "txCount"> & { sortOrder: number };
export type TagRow = Omit<BudgetTag, "txCount">;

export type AccountRow = Omit<Account, "value" | "lastSyncAt" | "fxMissing" | "valueNative">;

/** A security; cash holdings are derived from the account balances. */
export type SecurityRow = {
  id: string;
  accountId: string;
  ticker: string;
  name: string;
  /** Daily closes, oldest first, one per day of `HISTORY_DAYS` ending today. */
  closes: number[];
  composition: Composition | null;
  /** The quantity the provider reports, when the lots don't explain it. */
  reportedQty?: number;
  /** Day index of the first price (a fund launched inside the history):
   *  no price is served before it, as Yahoo has none. */
  listedFrom?: number;
};

export type ConnectionRow = Omit<SyncConnection, "accounts"> & { providerKey: string };

export type BaseData = {
  user: SessionUser;
  users: User[];
  sessions: Session[];
  mfa: MfaStatus;
  providers: Provider[];
  connections: ConnectionRow[];
  accounts: AccountRow[];
  /** Balance of each cash account (checking, savings, the PEA's liquidity)
   *  the day before `HISTORY_DAYS`; transactions move it from there. */
  openingCash: Record<string, number>;
  securities: SecurityRow[];
  manualLots: Record<string, Lot[]>;
  txns: TxnRow[];
  categories: CategoryRow[];
  tags: TagRow[];
  /** Exchange-rate gaps: securities with no rate today (left out of every
   *  sum, flagged ⚠), and no rate at all into the reader's currency. */
  /** `missing`: securities quoted in dollars with no dollar rate. `budget`:
   *  some transaction has no rate. `rateDown`: a currency change can't get
   *  its rate, so the server refuses it. */
  fx: { missing: string[]; budget: boolean; rateDown: boolean };
};

/** Days of price and balance history, today included. */
export const HISTORY_DAYS = 800;

export const USER_ID = id("usr", 1);
export const CHECKING = id("acc", 1);
export const SAVINGS = id("acc", 2);
export const PEA = id("acc", 3);
export const BANK = id("con", 1);
export const BROKER = id("con", 2);
export const CW8 = id("hol", 1);
export const ESE = id("hol", 2);

const CATEGORY_SEED: [string, string, string, string, BudgetCategory["kind"], string | null, string][] = [
  ["Housing", "housing", "#f18c80", "house", "expense", null, "Rent, mortgage payments, service charges and property tax."],
  ["Utilities", "utilities", "#ea945e", "zap", "expense", null, "Electricity, gas, water and heating."],
  ["Internet & phone", "internet_phone", "#d9a147", "smartphone", "expense", null, "Internet access, mobile and landline plans."],
  ["Groceries", "groceries", "#bfae46", "shopping-cart", "expense", null, "Supermarkets, grocers, markets and bakeries: food bought to take home."],
  ["Restaurants & bars", "restaurants", "#9cba5d", "utensils", "expense", null, "Eating and drinking out: restaurants, cafés, bars, fast food, canteens and food delivery."],
  ["Transport", "transport", "#72c27f", "train-front", "expense", null, "Getting around without fuel: trains, buses, metro passes, taxis, ride-hailing, tolls, parking, car hire and repairs."],
  ["Fuel", "fuel", "#41c6a3", "fuel", "expense", null, "Petrol, diesel and EV charging at service stations."],
  ["Insurance", "insurance", "#12c4c6", "shield", "expense", null, "Premiums for home, car, health, life and liability cover."],
  ["Health", "health", "#30bee3", "heart-pulse", "expense", null, "Doctors, dentists, pharmacies, opticians, hospitals and therapy."],
  ["Subscriptions", "subscriptions", "#60b4f5", "repeat", "expense", null, "Recurring memberships and services: streaming, software, news, cloud storage."],
  ["Leisure", "leisure", "#8aa9fc", "film", "expense", null, "Cinema, concerts, games, books, hobbies and nights out."],
  ["Sport", "sport", "#ae9df5", "activity", "expense", null, "Gyms, clubs, licences, lessons and sports gear."],
  ["Travel", "travel", "#cb93e2", "plane", "expense", null, "Trips away from home: flights, hotels, holiday rentals and long-distance tickets."],
  ["Shopping", "shopping", "#e18cc5", "shopping-bag", "expense", null, "General retail that fits no other category: electronics, household goods, beauty."],
  ["Clothing", "clothing", "#ee89a3", "shirt", "expense", null, "Clothes, shoes and accessories."],
  ["Home & furniture", "home_furniture", "#ef906e", "lamp", "expense", null, "Furniture, decoration, appliances, DIY and home maintenance."],
  ["Gifts & donations", "gifts", "#e39a51", "gift", "expense", null, "Presents bought for others, money given to family, and donations to charities."],
  ["Education", "education", "#cda743", "book-open", "expense", null, "Tuition, courses, exams, school fees and study material."],
  ["Cash withdrawals", "cash_withdrawals", "#aeb44f", "banknote", "expense", null, "Cash taken out at an ATM or a counter. What the cash was spent on afterwards is unknown."],
  ["Bank & broker fees", "bank_fees", "#88be6d", "percent", "expense", null, "Account and card fees, overdraft and payment interest, brokerage commissions, late-payment penalties."],
  ["Taxes", "taxes", "#5ac491", "landmark", "expense", null, "Payments to the tax authority: income tax, social contributions, local and vehicle taxes."],
  ["Pets", "pets", "#27c6b5", "paw-print", "expense", null, "Food, vets, insurance and supplies for an animal."],
  ["Other", "other_expense", "#10c4cb", "circle-dashed", "expense", null, "Expenses that fit no other category. Use only when nothing else is a reasonable match."],
  ["Salary", "salary", "#18c2d5", "wallet", "income", null, "Pay from an employer or client: wages, bonuses, pensions and self-employment income."],
  ["Dividends", "dividends", "#49baed", "coins", "income", null, "Dividends paid out by shares, funds and ETFs."],
  ["Interest", "interest", "#76affa", "piggy-bank", "income", null, "Interest paid by savings accounts, bonds and deposits."],
  ["Reimbursements", "reimbursements", "#9da3fa", "undo-2", "income", null, "Money coming back for something already paid: merchant refunds, expense claims, insurance and tax rebates."],
  ["Other income", "other_income", "#b99af0", "circle-plus", "income", null, "Incoming money that fits no other category: benefits, gifts received, one-off payments from people."],
  ["Internal transfer", "internal", "#be98ec", "arrow-left-right", "neutral", "internal_transfer", "Money moved between your own accounts. Neither spending nor income — the pairing pass writes here."],
  ["Savings", "savings", "#34d399", "piggy-bank", "neutral", null, "Money set aside into a savings account: it is still yours, not spending."],
  ["Investments", "investments", "#34d399", "trending-up", "neutral", null, "Money moved into a brokerage or investment account, and securities bought with it."],
  ["Ignore", "ignore", "#777471", "eye-off", "neutral", null, "Rows to leave out of every total: duplicates, corrections and anything that should not count."],
];

function categories(): CategoryRow[] {
  const order: Record<string, number> = {};
  return CATEGORY_SEED.map(([name, key, color, icon, kind, systemKey, hint], i) => {
    order[kind] = (order[kind] ?? 0) + 1;
    return {
      id: id("cat", i + 1),
      name,
      defaultKey: key,
      color,
      icon,
      hint,
      kind,
      systemKey,
      archived: false,
      sortOrder: order[kind],
    };
  });
}

/** The category id of a seeded default key. */
export function cat(rows: CategoryRow[], key: string): string {
  const row = rows.find((c) => c.defaultKey === key);
  if (!row) throw new Error(`no seeded category ${key}`);
  return row.id;
}

/** Daily closes ending at `last`, as a seeded random walk with a drift. */
export function closes(seed: number, last: number, drift: number, vol: number): number[] {
  const r = rng(seed);
  const out = new Array<number>(HISTORY_DAYS);
  out[HISTORY_DAYS - 1] = last;
  for (let i = HISTORY_DAYS - 2; i >= 0; i--) {
    const shock = (r() - 0.5) * 2 * vol;
    out[i] = Math.max(1, out[i + 1] / (1 + drift + shock));
  }
  return out.map((p) => Math.round(p * 100) / 100);
}

// Named as Boursorama names them (French, its October 2026 labels), as
// production stores them: the app translates them for display.
export const WORLD: Composition = {
  countries: [
    { name: "Etats-Unis", weight: 0.71 },
    { name: "Japon", weight: 0.055 },
    { name: "Royaume-Uni", weight: 0.037 },
    { name: "Canada", weight: 0.03 },
    { name: "France", weight: 0.027 },
    { name: "Suisse", weight: 0.025 },
    { name: "Allemagne", weight: 0.022 },
  ],
  sectors: [
    { name: "Technologie", weight: 0.26 },
    { name: "Finance", weight: 0.16 },
    { name: "Produits industriels", weight: 0.11 },
    { name: "Santé", weight: 0.1 },
    { name: "Biens de consommation cycliques", weight: 0.16 },
    { name: "Télécommunications", weight: 0.08 },
  ],
};

export const SP500: Composition = {
  countries: [{ name: "Etats-Unis", weight: 1 }],
  sectors: [
    { name: "Technologie", weight: 0.31 },
    { name: "Finance", weight: 0.13 },
    { name: "Santé", weight: 0.1 },
    { name: "Biens de consommation cycliques", weight: 0.1 },
    { name: "Télécommunications", weight: 0.09 },
    { name: "Produits industriels", weight: 0.08 },
  ],
};

/** Day index (0 = oldest history day) of a timestamp. */
export function dayIndex(t: number): number {
  return HISTORY_DAYS - 1 - Math.round((TODAY - t) / DAY_MS);
}

function transactions(cats: CategoryRow[], tags: TagRow[], securities: SecurityRow[], openingPeaCash: number): TxnRow[] {
  const r = rng(61);
  const rows: TxnRow[] = [];
  let n = 0;
  const c = (key: string) => cat(cats, key);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const amt = (lo: number, hi: number) => Math.round((lo + r() * (hi - lo)) * 100) / 100;

  function add(t: number, accountId: string, amount: number, description: string, type: string, categoryKey: string | null, extra: Partial<TxnRow> = {}): TxnRow {
    // The last month is still being worked through: some rows wait for a
    // category, and the AI has filed some with low confidence.
    const recent = TODAY - t < 30 * DAY_MS;
    const roll = r();
    let categoryId = categoryKey ? c(categoryKey) : null;
    let categorySource: TxnRow["categorySource"] = categoryId ? (roll < 0.5 ? "user" : "ai") : null;
    let categoryConfidence = categorySource === "ai" ? money(0.8 + r() * 0.19, 2) : null;
    let needsReview = false;
    if (recent && categoryKey && !extra.isTransfer) {
      if (roll < 0.15) {
        categoryId = null;
        categorySource = null;
        categoryConfidence = null;
      } else if (roll < 0.3) {
        categorySource = "ai";
        categoryConfidence = money(0.45 + r() * 0.2, 2);
        needsReview = true;
      }
    }
    const row: TxnRow = {
      id: id("txn", ++n),
      t,
      type,
      description,
      amount,
      accountId,
      source: "cash",
      holdingId: null,
      quantity: null,
      unitPrice: null,
      fee: null,
      categoryId,
      categorySource,
      categoryConfidence,
      needsReview,
      checked: !recent && r() < 0.6,
      isTransfer: false,
      isOrphanTransfer: false,
      tagIds: [],
      ...extra,
    };
    rows.push(row);
    return row;
  }

  function transfer(t: number, from: string, to: string, amount: number, outText: string, inText: string) {
    const pair = { categoryKey: "internal", extra: { isTransfer: true, categorySource: "pair" as const } };
    add(t, from, -amount, outText, "transfer", pair.categoryKey, pair.extra);
    add(t + DAY_MS, to, amount, inText, "transfer", pair.categoryKey, pair.extra);
  }

  const peaCash = { value: openingPeaCash };
  for (let m = 12; m >= 0; m--) {
    const start = new Date(TODAY);
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - m);
    const base = start.getTime();
    const day = (d: number) => base + (d - 1) * DAY_MS;
    const inPast = (t: number) => t <= TODAY;
    const at = (d: number, f: (t: number) => void) => {
      const t = day(d);
      if (inPast(t)) f(t);
    };

    at(1, (t) => add(t, CHECKING, 2850 + (m % 6 === 0 ? 400 : 0), "VIR SEPA ACME SAS SALAIRE", "transfer", "salary"));
    at(3, (t) => add(t, CHECKING, -950, "PRLV SEPA FONCIA LOYER", "order", "housing"));
    at(5, (t) => add(t, CHECKING, -amt(45, 95), "PRLV SEPA EDF CLIENTS PARTICULIERS", "order", "utilities"));
    at(7, (t) => add(t, CHECKING, -29.99, "PRLV SEPA FREE MOBILE", "order", "internet_phone"));
    at(8, (t) => add(t, CHECKING, -86.4, "CB NAVIGO ANNUEL", "card", "transport"));
    at(9, (t) => add(t, CHECKING, -13.49, "CB NETFLIX.COM", "card", "subscriptions"));
    at(12, (t) => add(t, CHECKING, -10.99, "CB SPOTIFY P1A2B3", "card", "subscriptions"));
    at(14, (t) => add(t, CHECKING, -32.5, "PRLV SEPA MAIF ASSURANCE", "order", "insurance"));
    at(10, (t) => transfer(t, CHECKING, SAVINGS, 300, "VIR VERS LIVRET A", "VIR DEPUIS COMPTE COURANT"));
    at(15, (t) => {
      transfer(t, CHECKING, PEA, 600, "VIR VERS PEA BOURSORAMA", "VIREMENT RECU M CAMILLE MARTIN");
      peaCash.value += 600;
      // Two days later the PEA buys one ETF, each in turn, for up to 600 €.
      const buyT = t + 2 * DAY_MS;
      if (!inPast(buyT)) return;
      const sec = securities[m % 2];
      const price = sec.closes[dayIndex(buyT)];
      const fee = 1.99;
      const qty = Math.floor((Math.min(peaCash.value, 600) - fee) / price);
      if (qty <= 0) return;
      peaCash.value -= qty * price + fee;
      rows.push({
        id: id("txn", ++n),
        t: buyT,
        type: "buy",
        description: null,
        amount: -(qty * price + fee),
        accountId: PEA,
        source: "lot",
        holdingId: sec.id,
        quantity: qty,
        unitPrice: price,
        fee,
        categoryId: c("investments"),
        categorySource: "user",
        categoryConfidence: null,
        needsReview: false,
        checked: false,
        isTransfer: false,
        isOrphanTransfer: false,
        tagIds: [],
      });
    });

    for (const d of [2, 9, 16, 23, 29]) {
      at(d, (t) => add(t, CHECKING, -amt(28, 115), pick(["CB CARREFOUR MARKET", "CB MONOPRIX PARIS 11", "CB LIDL", "CB BIOCOOP"]), "card", "groceries"));
    }
    for (const d of [4, 11, 18, 25]) {
      at(d, (t) => add(t, CHECKING, -amt(12, 68), pick(["CB LE PETIT BISTROT", "CB UBER EATS", "CB CAFE DES AMIS", "CB DELIVEROO"]), "card", "restaurants"));
    }
    at(20, (t) => add(t, CHECKING, -amt(15, 120), pick(["CB FNAC", "CB AMAZON EU", "CB DECATHLON"]), "card", pick(["shopping", "leisure", "sport"])));
    at(22, (t) => add(t, CHECKING, -amt(25, 60), "CB PHARMACIE DU MARCHE", "card", "health"));
    at(26, (t) => add(t, CHECKING, -60, "RETRAIT DAB 26/", "withdrawal", "cash_withdrawals"));
    if (m === 4) {
      at(6, (t) => add(t, CHECKING, -642.3, "CB AIR FRANCE", "card", "travel", { tagIds: [tags[0].id] }));
      at(19, (t) => add(t, CHECKING, -418, "CB AIRBNB * HMXYZ", "card", "travel", { tagIds: [tags[0].id] }));
    }
    if (m === 2) {
      at(13, (t) => add(t, CHECKING, -89.9, "CB LEROY MERLIN", "card", "home_furniture", { tagIds: [tags[2].id] }));
      at(21, (t) => add(t, CHECKING, 45, "VIR CPAM REMBOURSEMENT", "transfer", "reimbursements", { tagIds: [tags[1].id] }));
    }
    if (m === 9) at(28, (t) => add(t, SAVINGS, 156.12, "INTERETS CREDITEURS", "deposit", "interest"));
  }
  return rows.sort((a, b) => b.t - a.t || b.id.localeCompare(a.id));
}

export function baseData(): BaseData {
  const cats = categories();
  const tags: TagRow[] = [
    { id: id("tag", 1), name: "Holidays", color: "#60b4f5" },
    { id: id("tag", 2), name: "Refundable", color: "#ea945e" },
    { id: id("tag", 3), name: "Renovation", color: null },
  ];
  const securities: SecurityRow[] = [
    { id: CW8, accountId: PEA, ticker: "CW8", name: "Amundi MSCI World UCITS ETF", closes: closes(1, 541.32, 0.0003, 0.012), composition: WORLD },
    { id: ESE, accountId: PEA, ticker: "ESE", name: "BNP Paribas Easy S&P 500 UCITS ETF", closes: closes(2, 28.47, 0.0004, 0.014), composition: SP500 },
  ];
  const openingCash = { [CHECKING]: 2400, [SAVINGS]: 6200, [PEA]: 150 };
  const lastSync = Date.now() - 2 * 3_600_000;
  const health = { verified: true, lastUpdatedOn: isoDay(TODAY), state: null, errorMessage: null, nextRetryOn: null };

  return {
    user: {
      id: USER_ID,
      name: "Camille Martin",
      email: "camille@example.com",
      role: "admin",
      prefs: { ...DEFAULT_PREFS },
      welcomeDone: true,
    },
    users: [
      { id: USER_ID, name: "Camille Martin", email: "camille@example.com", role: "admin", joinedAt: daysAgo(420), isSelf: true },
      { id: id("usr", 2), name: "Alex Durand", email: "alex@example.com", role: "user", joinedAt: daysAgo(130), isSelf: false },
    ],
    sessions: [
      { id: id("ses", 1), device: "Firefox on Linux", ip: "192.0.2.14", createdAt: daysAgo(12), lastActiveAt: Date.now(), remembered: true, current: true },
      { id: id("ses", 2), device: "Safari on iPhone", ip: "198.51.100.7", createdAt: daysAgo(40), lastActiveAt: daysAgo(2), remembered: true, current: false },
    ],
    mfa: { totp: false, recoveryRemaining: 0, passkeys: [] },
    providers: [{ key: "powens", displayName: "Powens", description: "French and European banks and brokers.", enabled: true }],
    connections: [
      { providerKey: "powens", id: BANK, displayName: "Crédit Mutuel", status: "ok", lastSyncAt: lastSync, lastError: null, logo: null, canManage: true, health },
      { providerKey: "powens", id: BROKER, displayName: "Boursorama", status: "ok", lastSyncAt: lastSync, lastError: null, logo: null, canManage: true, health },
    ],
    accounts: [
      { id: CHECKING, connectionId: BANK, name: "Compte courant", color: "#60b4f5", typeKey: "checking", currency: "EUR", sourceName: "Crédit Mutuel", sourceLogo: null },
      { id: SAVINGS, connectionId: BANK, name: "Livret A", color: "#34d399", typeKey: "savings", currency: "EUR", sourceName: "Crédit Mutuel", sourceLogo: null },
      { id: PEA, connectionId: BROKER, name: "PEA", color: "#cb93e2", typeKey: "pea", currency: "EUR", sourceName: "Boursorama", sourceLogo: null },
    ],
    openingCash,
    securities,
    manualLots: {},
    txns: transactions(cats, tags, securities, openingCash[PEA]),
    categories: cats,
    tags,
    fx: { missing: [], budget: false, rateDown: false },
  };
}
