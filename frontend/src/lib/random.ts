// Deterministic, seedable helpers shared by the fake-data generators, so the
// same holding always produces the same series across renders.

// mulberry32 — a tiny seeded PRNG.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a string hash → 32-bit seed.
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// A noisy-but-smooth path of `n` points from `startV` to `endV` (endpoints exact).
export function walk(
  seed: number,
  n: number,
  startV: number,
  endV: number,
  vol: number,
): number[] {
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
