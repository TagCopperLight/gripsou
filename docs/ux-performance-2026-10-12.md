# Search, lot preview and navigation performance

Measured on 2026-10-12 against baseline `6e89c29` using the `typical`
fixture: 5,000 transactions, 13 holdings and 1,300 days of history.
Each measurement uses 3 warmups and 30 reported samples on the same machine.
The candidate measurements were collected after CI finished, with no concurrent
build or test run.

| Browser operation | Before median | After median | Reduction | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Transaction search | 498.9 ms | 337.2 ms | 32.4% | 531.6 ms | 364.2 ms |
| Lot dialog with populated preview | 431.5 ms | 137.6 ms | 68.1% | 449.3 ms | 146.8 ms |
| Return to cached dashboard | 181.5 ms | 99.3 ms | 45.3% | 183.1 ms | 116.1 ms |
| Repeated navigation | 698.6 ms | 481.5 ms | 31.1% | 715.9 ms | 499.0 ms |

Repeated navigation measures four route changes together, not one page load.
Search measures typing without pressing Enter; Enter now submits immediately.
These local browser timings do not include a remote network connection.

The changes shorten search debounce from 300 to 150 ms, request the initial
populated lot preview immediately, and reuse portfolio queries for 30 seconds.
User edits still debounce lot previews for 300 ms. Older preview responses cannot
overwrite figures after a newer edit. Syncs, account edits, lot saves and
reporting preference changes retain their existing cache invalidation.

Reproduce before and after with:

```sh
scripts/bench run --suite browser --profile typical --only browser.transactions.search,browser.lots.open,browser.dashboard.return-cached,browser.navigation.repeat --save /tmp/ux.json
```

Raw results are saved locally as `benchmarks/results/20261012-ux-before.json`
and `benchmarks/results/20261012-ux-after.json` (gitignored).
The comparison command reports `compatible: false` solely because
`environment.frontend_build` changed, as expected for this frontend change.
It reports no other environment, fixture, contract or semantic-outcome mismatch;
all four cases pass their correctness checks in both runs.

Validation also includes `./ci.sh` (779 Rust tests, 796 frontend tests and
59 benchmark UI tests) and all 12 browser cases on the typical fixture with
1 warmup and 3 reported samples. The shorter full-suite run checks correctness;
the table uses only the focused 30-sample runs.

The first candidate run overlapped CI, encountered a navigation readiness
failure during a frontend rebuild, and was discarded. Only the subsequent quiet
run is reported above. These results cover this fixture and machine; sync
ingestion and history-query performance require separate optimization.
