// Fake holdings for local testing of the Holdings card. Ported from the mock
// data: raw positions get value / unrealised P/L computed, plus a synthetic
// 30-day price series for the sparkline. Cash positions have no P/L or series.

export type HoldingKind = "cash" | "etf" | "stock" | "crypto";

export type Holding = {
  ticker: string;
  name: string;
  kind: HoldingKind;
  /** Placeholder logo colour until real asset logos exist. */
  logo: string;
  accountId: string;
  accountName: string;
  accountColor: string;
  category: string;
  qty: number;
  price: number;
  invested: number;
  value: number;
  /** Unrealised gain/loss in currency. */
  gl: number;
  /** Unrealised gain/loss as a ratio (for the Percent component). */
  glPct: number;
  /** 30-day unit-price series for the sparkline; null for cash. */
  spark: number[] | null;
};

export const KIND_LABEL: Record<HoldingKind, string> = {
  cash: "Cash",
  etf: "ETF",
  stock: "Stock",
  crypto: "Crypto",
};

const ACCOUNTS: Record<string, { name: string; color: string }> = {
  checking: { name: "Compte Courant", color: "#6ea8fe" },
  livret: { name: "Livret A", color: "#5ed3c4" },
  pea: { name: "PEA", color: "#c084fc" },
  tr: { name: "Trade Republic", color: "#f0b35b" },
  kraken: { name: "Crypto", color: "#f49ac1" },
};

type RawHolding = {
  ticker: string;
  name: string;
  accountId: string;
  cat: string;
  qty: number;
  price: number;
  invested: number;
  logo: string;
  kind: HoldingKind;
};

const RAW: RawHolding[] = [
  { ticker: "EUR", name: "Euro — espèces", accountId: "checking", cat: "Cash", qty: 4210.55, price: 1, invested: 4210.55, logo: "#6ea8fe", kind: "cash" },
  { ticker: "EUR", name: "Livret A", accountId: "livret", cat: "Cash", qty: 22950.0, price: 1, invested: 22600.0, logo: "#5ed3c4", kind: "cash" },
  { ticker: "CW8", name: "Amundi MSCI World UCITS", accountId: "pea", cat: "PEA", qty: 78, price: 540.2, invested: 36000.0, logo: "#2e7d6b", kind: "etf" },
  { ticker: "AI", name: "Air Liquide", accountId: "pea", cat: "PEA", qty: 60, price: 168.4, invested: 9300.0, logo: "#1d4e89", kind: "stock" },
  { ticker: "MC", name: "LVMH", accountId: "pea", cat: "PEA", qty: 18, price: 642.0, invested: 13200.0, logo: "#3a3a3a", kind: "stock" },
  { ticker: "TTE", name: "TotalEnergies", accountId: "pea", cat: "PEA", qty: 80, price: 57.8, invested: 4100.0, logo: "#c4452f", kind: "stock" },
  { ticker: "VWCE", name: "Vanguard FTSE All-World", accountId: "tr", cat: "Brokerage", qty: 180, price: 132.4, invested: 20500.0, logo: "#9b1c2c", kind: "etf" },
  { ticker: "AAPL", name: "Apple Inc.", accountId: "tr", cat: "Brokerage", qty: 60, price: 214.3, invested: 11000.0, logo: "#555a5e", kind: "stock" },
  { ticker: "NVDA", name: "NVIDIA Corp.", accountId: "tr", cat: "Brokerage", qty: 95, price: 128.5, invested: 6800.0, logo: "#3f7d28", kind: "stock" },
  { ticker: "ASML", name: "ASML Holding", accountId: "tr", cat: "Brokerage", qty: 8, price: 660.0, invested: 6100.0, logo: "#2a5db0", kind: "stock" },
  { ticker: "BTC", name: "Bitcoin", accountId: "kraken", cat: "Brokerage", qty: 0.34, price: 92400, invested: 18500.0, logo: "#d98318", kind: "crypto" },
  { ticker: "ETH", name: "Ethereum", accountId: "kraken", cat: "Brokerage", qty: 1.6, price: 3180, invested: 6400.0, logo: "#5b6ad0", kind: "crypto" },
  { ticker: "SOL", name: "Solana", accountId: "kraken", cat: "Brokerage", qty: 4.0, price: 146.5, invested: 720.0, logo: "#6f4fd0", kind: "crypto" },
];

// --- seeded RNG + smooth random walk, ported from the mock generators ---
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function walk(seed: number, n: number, startV: number, endV: number, vol: number): number[] {
  const r = rng(seed);
  const noise = [0];
  for (let i = 1; i < n; i++) noise.push(noise[i - 1] + (r() - 0.5) * vol);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = startV + (endV - startV) * (i / (n - 1));
    out.push(base + noise[i] * startV * 0.012);
  }
  out[0] = startV;
  out[n - 1] = endV;
  return out;
}

// 30-day unit-price series ending at the current price.
function spark(h: RawHolding): number[] {
  const n = 60;
  const start = h.price * 0.93;
  const vol = h.kind === "crypto" ? 3.2 : h.kind === "stock" ? 1.8 : 1.0;
  return walk(hashStr(h.ticker + "1mo"), n, start, h.price, vol);
}

export const FAKE_HOLDINGS: Holding[] = RAW.map((h) => {
  const value = h.qty * h.price;
  const gl = value - h.invested;
  const account = ACCOUNTS[h.accountId];
  return {
    ticker: h.ticker,
    name: h.name,
    kind: h.kind,
    logo: h.logo,
    accountId: h.accountId,
    accountName: account.name,
    accountColor: account.color,
    category: h.cat,
    qty: h.qty,
    price: h.price,
    invested: h.invested,
    value,
    gl,
    glPct: h.invested ? gl / h.invested : 0,
    spark: h.kind === "cash" ? null : spark(h),
  };
});

// Distinct categories in first-seen order, for the filter tags.
export function holdingCategories(holdings: Holding[] = FAKE_HOLDINGS): string[] {
  return [...new Set(holdings.map((h) => h.category))];
}
