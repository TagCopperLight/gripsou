export type DistributionAccount = {
  id: string;
  /** Display name of the account. */
  name: string;
  /** Category label shown as a tag, e.g. "Cash" / "PEA" / "Brokerage". */
  category: string;
  /** Slice/marker colour; shared between the donut and the legend row. */
  color: string;
  /** Current value of the account. */
  value: number;
};

// Fake per-account balances for local testing of the distribution card.
// Mirrors the mock accounts; values sum to the dashboard net worth.
export const FAKE_DISTRIBUTION: DistributionAccount[] = [
  { id: "checking", name: "Compte Courant", category: "Cash", color: "#6ea8fe", value: 4210.55 },
  { id: "livret", name: "Livret A", category: "Cash", color: "#5ed3c4", value: 22950.0 },
  { id: "pea", name: "PEA", category: "PEA", color: "#c084fc", value: 68419.6 },
  { id: "tr", name: "Trade Republic", category: "Brokerage", color: "#f0b35b", value: 54177.5 },
  { id: "kraken", name: "Crypto", category: "Brokerage", color: "#f49ac1", value: 37090.0 },
];

export function distributionTotal(
  accounts: DistributionAccount[] = FAKE_DISTRIBUTION,
): number {
  return accounts.reduce((sum, a) => sum + a.value, 0);
}
