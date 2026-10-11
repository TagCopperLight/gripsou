# Performance improvements, 12 October 2026

The `performance` branch targets chart readiness, transaction counts, and
transaction rendering. APIs and financial calculations retain their existing
behavior.

## Changes

- Charts render without entry/update animation. Line charts reuse their instance
  when the range or unit changes instead of remounting. Tooltips, hover handlers,
  readiness events, and resizing remain enabled.
- Transaction counts materialize account and reporting FX rates together for
  each needed date and account currency, then join once. The previous generic
  query plan repeatedly scanned reporting rates for every transaction. An
  isolated query plan recorded 6,495,000 rejected date comparisons; the rewrite
  eliminates that join. Monetary arithmetic remains per row, with the same
  missing-rate and zero-rate fallback rules.
- Tag cells with zero or one tag skip hidden measurement elements, synchronous
  layout reads, and resize observers. Cells with multiple tags keep the existing
  overflow behavior.
- Number formatting reuses up to 32 Intl formatters. Currency symbols,
  separators, and positioning still reflect current preferences on every call.

## Measurements

Times are milliseconds. Median and p95 use the benchmark runner's nearest-rank
calculation. All measurements below passed semantic correctness checks.

| Operation | Median before | Median after | p95 before | p95 after |
| --- | ---: | ---: | ---: | ---: |
| Counts, typical | 406.2 | 23.4 | 423.9 | 27.5 |
| Counts, multi-currency | 932.0 | 105.9 | 954.7 | 109.9 |
| Dashboard, fresh | 1248.3 | 299.9 | 1270.2 | 349.5 |
| Dashboard, cached return | 1099.2 | 165.2 | 1116.6 | 182.8 |
| Investments, fresh | 1286.9 | 306.3 | 1319.1 | 319.6 |
| Chart range change | 515.9 | 281.8 | 599.1 | 299.6 |
| Transactions, ready | 396.0 | 346.1 | 416.2 | 366.1 |
| Transactions, search | 566.6 | 498.4 | 583.1 | 531.8 |
| Transactions, filter | 368.3 | 301.2 | 402.1 | 333.2 |
| Transactions, next page | 287.0 | 220.3 | 336.7 | 252.6 |

Search long tasks fell from 14 to one across 14 trials; the remaining task took
53 ms. Filtering's median recorded long task fell from 106 to 53 ms. Initial
page startup long tasks remain; this change does not eliminate all main-thread
work.

## Method and limits

- Backend: 12 samples and three warmups per case. Browser: ten samples and three
  warmups. First trials and warmups are excluded from the reported timings.
- Browser trials used the typical fixture: 5,000 transactions, 13 holdings,
  six accounts, and 1,300 days of history. Runs used the same machine and options.
- Reported benchmark runs and heavy validation commands acquired
  `/tmp/gripsou-performance-bench.lock` with `flock`, preventing overlap.
- Browser readiness includes finished charts and required API responses. Removing
  animation reduces this boundary directly; content may have been visible
  before animation finished in the original version.
- Browser results measure the combined frontend candidate, including formatter
  reuse. They do not isolate each individual change. The counts rewrite was
  present in both transaction-browser builds.
- The browser comparison command flags the changed `frontend_build` hash as an
  environment mismatch. This is the intentional product build change; fixtures,
  options, and semantic outcomes were checked separately. The backend comparison
  has identical fixture fingerprints, environments, and complete outcomes.
- The original multi-currency baseline used a preserved release executable,
  verified to contain the original SQL. Its runtime dirty fingerprint reflects
  the shared working tree, rather than the preserved executable's source state.
- These are local synthetic-data measurements, not production or WAN latency
  guarantees. Sync ingestion and backfill remain candidates for later work.

Raw before/after reports are saved in `benchmarks/results/performance-*.json`.

## Validation

`./ci.sh` passed: Rust formatting, Clippy, backend tests, frontend lint,
777 frontend tests, production build, and benchmark UI checks. The SQLx query
cache was regenerated. An independent read-only review found no significant
regressions in FX arithmetic, chart lifecycle, accessibility, or formatting.

Additional browser checks (five samples, three warmups) verified accounts,
budget, and repeated navigation on the combined candidate. Medians were
320.6 ms, 320.0 ms, and 648.5 ms respectively. Their report is saved as
`benchmarks/results/performance-readiness.json`.
