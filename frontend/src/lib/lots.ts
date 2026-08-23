/** One row of the record-lots table, already parsed into numbers. */
export type LotRow = { type: "buy" | "sell"; quantity: number; unitPrice: number };

export type Figures = {
  /** μ — the lifetime mean buy price. */
  meanPrice: number;
  /** Σ buy qty − Σ sell qty. Signed: negative means more sold than bought. */
  netQty: number;
  /** μ × netQty — the basis still held. */
  invested: number;
  realised: number;
  unrealised: number;
};

const ZERO: Figures = { meanPrice: 0, netQty: 0, invested: 0, realised: 0, unrealised: 0 };

/** Spec §4.1. μ = Σ(buy qty × price) / Σ(buy qty), over ALL buys regardless of
 *  order, then every other figure derives from it:
 *
 *      invested   = μ × netQty
 *      realised   = Σ sells qty × (price − μ)
 *      unrealised = netQty × currentPrice − invested
 *
 *  Order-independent on purpose. A running average would be marginally more
 *  faithful when a buy follows a sell, but it needs a recursive CTE in
 *  `backfill.rs` to match, and every edit would recompute the chain. This must
 *  stay identical to the SQL in `backfill.rs` and `query.rs` — if one changes,
 *  all three change, or the modal and the chart disagree.
 *
 *  `currentPrice` is price-domain while the rows are amount-domain; the two
 *  coincide whenever the account and the listing share a currency, which is the
 *  same approximation `AssetModal` already documents for its purchases chart.
 */
export function resultingFigures(rows: LotRow[], currentPrice: number): Figures {
  let buyQty = 0;
  let buyCost = 0;
  let sellQty = 0;
  for (const r of rows) {
    if (r.type === "buy") {
      buyQty += r.quantity;
      buyCost += r.quantity * r.unitPrice;
    } else {
      sellQty += r.quantity;
    }
  }
  const netQty = buyQty - sellQty;
  // No buys means no mean, and every figure derived from it is meaningless
  // rather than zero — but the table is a work in progress, so report zeros and
  // let the bar's red state carry the "this cannot be right" signal.
  if (buyQty === 0) return { ...ZERO, netQty };

  const meanPrice = buyCost / buyQty;
  const invested = meanPrice * netQty;
  let realised = 0;
  for (const r of rows) {
    if (r.type === "sell") realised += r.quantity * (r.unitPrice - meanPrice);
  }
  return {
    meanPrice,
    netQty,
    invested,
    realised,
    unrealised: netQty * currentPrice - invested,
  };
}
