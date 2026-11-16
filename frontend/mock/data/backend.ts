// Copied from the backend: what the server seeds or declares that the mock answers with too.
// Each block names its source; keep them in step.

import type { ApiKeyProvider, BudgetCategory } from "../../src/api/wire.ts";

/** `seed_budget_categories` (backend/migrations/0059_budget_category_hints.sql). */
export const CATEGORY_SEED: [string, string, string, string, BudgetCategory["kind"], string | null, string][] = [
  ["Housing", "housing", "#f18c80", "house", "expense", null, "Rent, mortgage payments, service charges and property tax."],
  ["Utilities", "utilities", "#ea945e", "zap", "expense", null, "Electricity, gas, water and heating bills."],
  ["Internet & phone", "internet_phone", "#d9a147", "smartphone", "expense", null, "Internet, mobile and landline plans."],
  ["Groceries", "groceries", "#bfae46", "shopping-cart", "expense", null, "Supermarkets, grocers, markets and bakeries: food and household basics bought to take home."],
  ["Restaurants & bars", "restaurants", "#9cba5d", "utensils", "expense", null, "Restaurants, cafés, bars, fast food, canteens and food delivery."],
  ["Transport", "transport", "#72c27f", "train-front", "expense", null, "Trains, buses, metro passes, taxis, ride-hailing, tolls, parking, car hire and car repairs. Not fuel."],
  ["Fuel", "fuel", "#41c6a3", "fuel", "expense", null, "Petrol, diesel and electric car charging."],
  ["Insurance", "insurance", "#12c4c6", "shield", "expense", null, "Home, car, health, life and liability insurance premiums."],
  ["Health", "health", "#30bee3", "heart-pulse", "expense", null, "Doctors, dentists, pharmacies, opticians, hospitals and therapy."],
  ["Subscriptions", "subscriptions", "#60b4f5", "repeat", "expense", null, "Recurring services and memberships: streaming, software, news, cloud storage."],
  ["Leisure", "leisure", "#8aa9fc", "film", "expense", null, "Cinema, concerts, games, books, hobbies and nights out."],
  ["Sport", "sport", "#ae9df5", "activity", "expense", null, "Gyms, clubs, licences, lessons and sports gear."],
  ["Travel", "travel", "#cb93e2", "plane", "expense", null, "Trips away from home: flights, hotels, holiday rentals and long-distance train or coach tickets."],
  ["Shopping", "shopping", "#e18cc5", "shopping-bag", "expense", null, "General retail with no better category: electronics, household goods, beauty."],
  ["Clothing", "clothing", "#ee89a3", "shirt", "expense", null, "Clothes, shoes and accessories."],
  ["Home & furniture", "home_furniture", "#ef906e", "lamp", "expense", null, "Furniture, decoration, appliances, DIY and home repairs."],
  ["Gifts & donations", "gifts", "#e39a51", "gift", "expense", null, "Presents for others, money given to family or friends, and donations to charities."],
  ["Education", "education", "#cda743", "book-open", "expense", null, "Tuition, courses, exams, school fees and study material."],
  ["Cash withdrawals", "cash_withdrawals", "#aeb44f", "banknote", "expense", null, "Cash taken out at an ATM or a bank counter."],
  ["Bank & broker fees", "bank_fees", "#88be6d", "percent", "expense", null, "Account and card fees, overdraft interest, brokerage commissions and late-payment penalties."],
  ["Taxes", "taxes", "#5ac491", "landmark", "expense", null, "Income tax, social contributions, and local and vehicle taxes paid to the state."],
  ["Pets", "pets", "#27c6b5", "paw-print", "expense", null, "Pet food, vets, pet insurance and supplies."],
  ["Other", "other_expense", "#10c4cb", "circle-dashed", "expense", null, "Spending with no better category. Use only when nothing else fits."],
  ["Salary", "salary", "#18c2d5", "wallet", "income", null, "Pay from an employer or clients: wages, bonuses, pensions and self-employment income."],
  ["Dividends", "dividends", "#49baed", "coins", "income", null, "Dividends paid by shares, funds and ETFs."],
  ["Interest", "interest", "#76affa", "piggy-bank", "income", null, "Interest paid by savings accounts, bonds and deposits."],
  ["Reimbursements", "reimbursements", "#9da3fa", "undo-2", "income", null, "Money back for something already paid: refunds, expense claims, insurance payouts and tax rebates."],
  ["Other income", "other_income", "#b99af0", "circle-plus", "income", null, "Incoming money with no better category: benefits, gifts received, one-off payments from people."],
  ["Internal transfer", "internal", "#be98ec", "arrow-left-right", "neutral", "internal_transfer", "Money moved between your own accounts. gripsou finds these itself."],
  ["Savings", "savings", "#34d399", "piggy-bank", "neutral", null, "Money put into a savings account. It is still yours, so it is not spending."],
  ["Investments", "investments", "#34d399", "trending-up", "neutral", null, "Money moved into a brokerage or investment account, and securities bought with it."],
  ["Ignore", "ignore", "#777471", "eye-off", "neutral", null, "Transactions to leave out of every total: duplicates, corrections, and anything that shouldn't count."],
];

/** The providers with API keys, in the registry's order (backend/providers/src/registry.rs).
 *  `optional`: a field the provider works without. */
export const CONFIG_PROVIDERS: (Pick<ApiKeyProvider, "key" | "displayName" | "group" | "returnAddress"> & {
  fields: { key: string; label: string; secret: boolean; optional?: true }[];
})[] = [
  {
    key: "powens",
    displayName: "Powens",
    group: "bank",
    returnAddress: "https://gripsou.example/connections/callback",
    fields: [
      { key: "client_id", label: "Client ID", secret: false },
      { key: "domain", label: "Domain", secret: false },
      { key: "client_secret", label: "Client secret", secret: true },
      { key: "webhook_secret", label: "Webhook secret", secret: true, optional: true },
    ],
  },
  { key: "jev", displayName: "JEV", group: "categorize", returnAddress: null, fields: [{ key: "api_key", label: "API key", secret: true }] },
  {
    key: "brandfetch",
    displayName: "Brandfetch",
    group: "logos",
    returnAddress: null,
    fields: [{ key: "client_id", label: "Client ID", secret: false }],
  },
];

/** `ApiKeyProvider.ready` (backend/api/src/admin/dto.rs): every field the provider needs is set. */
export function keysReady(p: ApiKeyProvider): boolean {
  const declared = CONFIG_PROVIDERS.find((c) => c.key === p.key)?.fields ?? [];
  return p.fields.every((f) => declared.find((d) => d.key === f.key)?.optional || (f.secret ? f.set : f.value !== null));
}

// The Overview's rules (backend/core/src/budget/overview/calc.rs).
export const SANKEY_MIN_SHARE = 0.02;
export const SANKEY_MAX_SLICES = 8;
export const BREAKDOWN_KEEP = 7;
export const MIN_BASELINE_MONTHS = 3;
export const BASELINE_MONTHS = 12;
export const TREND_KEEP = SANKEY_MAX_SLICES;
export const TREND_ANCHOR_KEEP = 3;
/** The seed key of the category the trend folds into Other (`SeedKey`, backend/core/src/budget/vocab.rs). */
export const TREND_FOLD_KEY = "other_expense";
