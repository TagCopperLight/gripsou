export type NetWorthPoint = {
  /** Epoch milliseconds. */
  t: number;
  netWorth: number;
  invested: number;
};

// Fake 6-month daily series for local testing: capital grows in occasional
// deposit steps; net worth drifts above it with market-like noise.
export function generateFakeNetWorthData(days = 180): NetWorthPoint[] {
  const points: NetWorthPoint[] = [];
  const start = Date.now() - days * 86_400_000;

  let invested = 150_000;
  let netWorth = 150_000;

  for (let i = 0; i < days; i++) {
    if (Math.random() < 0.04) {
      const deposit = 2_000 + Math.random() * 4_000; // sporadic deposit
      invested += deposit;
      netWorth += deposit; // cash added shows up in both lines
    }
    const dailyReturn = (Math.random() - 0.46) * 0.012; // slight upward bias
    netWorth *= 1 + dailyReturn; // market moves net worth, not invested capital

    points.push({
      t: start + i * 86_400_000,
      netWorth: Math.round(netWorth * 100) / 100,
      invested: Math.round(invested * 100) / 100,
    });
  }
  return points;
}
