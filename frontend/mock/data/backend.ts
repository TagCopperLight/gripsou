// Copied from the backend: what the server seeds or declares that the mock
// answers with too. Each block names its source; keep them in step.

import type { BudgetCategory } from "../../src/api/wire.ts";

/** `seed_budget_categories` (backend/migrations/0033_budget_neutral_kind.sql):
 *  name, default key, colour, icon, kind, system key, hint. */
export const CATEGORY_SEED: [string, string, string, string, BudgetCategory["kind"], string | null, string][] = [
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

/** The providers with API keys, in the registry's order
 *  (backend/providers/src/registry.rs), each with its `fields`
 *  (providers/src/powens, providers/src/jev, providers/src/brandfetch.rs). */
export const CONFIG_PROVIDERS: { key: string; displayName: string; fields: { key: string; label: string; secret: boolean }[] }[] = [
  {
    key: "powens",
    displayName: "Powens",
    fields: [
      { key: "client_id", label: "Client ID", secret: false },
      { key: "domain", label: "Domain", secret: false },
      { key: "client_secret", label: "Client secret", secret: true },
      { key: "webhook_secret", label: "Webhook secret", secret: true },
    ],
  },
  { key: "jev", displayName: "JEV", fields: [{ key: "api_key", label: "API key", secret: true }] },
  { key: "brandfetch", displayName: "Brandfetch", fields: [{ key: "client_id", label: "Client ID", secret: false }] },
];

// The Overview's rules (backend/core/src/budget/overview/calc.rs).
/** A Sankey side keeps slices of at least this share of the period's expenses... */
export const SANKEY_MIN_SHARE = 0.02;
/** ...and at most this many, Other excluded. */
export const SANKEY_MAX_SLICES = 8;
export const BREAKDOWN_KEEP = 7;
/** Months of history a comparison needs, and how far back it averages. */
export const MIN_BASELINE_MONTHS = 3;
export const BASELINE_MONTHS = 12;
export const TREND_KEEP = SANKEY_MAX_SLICES;
/** The anchor month's largest slices the trend always keeps. */
export const TREND_ANCHOR_KEEP = 3;
/** The seed key of the category the trend folds into Other (`SeedKey` in
 *  backend/core/src/budget/vocab.rs, migration 0055). */
export const TREND_FOLD_KEY = "other_expense";
