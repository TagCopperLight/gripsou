# Application benchmarks

Use `scripts/bench list` to discover stable target IDs and `scripts/bench list --profiles` for fixture dimensions. Builds use release mode. The old `cargo run -p gripsou-jobs --example perf` remains available, but its debug timings are not comparable to this runner.

PostgreSQL must allow the supplied DATABASE_URL role to create databases. The URL supplies connection settings only: the runner creates migrated scratch databases from template0, freezes their business calendar at 2026-01-15, seeds synthetic data and closes a template before cloning trials. It never seeds the source database. Exact database names and ownership markers are recorded in a private temporary manifest. Normal errors and panics trigger cleanup; after an interrupted process use `scripts/bench cleanup /tmp/gripsou-bench-<run>.json`. Cleanup refuses names without a matching ownership marker.

```sh
scripts/bench run --profile typical --only transactions.search.common,transactions.page.first,transactions.page.deep,transactions.counts --transactions 20000 --repeat 3 --save /tmp/baseline.json
# Make the optimization, then run the identical workload on the same machine.
scripts/bench run --profile typical --only transactions.search.common,transactions.page.first,transactions.page.deep,transactions.counts --transactions 20000 --repeat 3 --save /tmp/candidate.json
scripts/bench compare /tmp/baseline.json /tmp/candidate.json
scripts/bench check /tmp/baseline.json /tmp/candidate.json --goal benchmarks/goals/transactions-search.json
```

The example goal requires a 25% median improvement in common search and limits regression of first/deep pages and counts to 10%. The check needs exactly three independent runs, at least 30 measured samples for median goals (100 for p95), matching fixtures/parameters/environment, successful correctness checks, identical semantic outcomes, and run median spread at most 10%. Different commits are expected. A goal can acknowledge specific environment differences; the evaluation preserves them. Missing guardrails, partial reports, zero baselines and excessive noise cannot pass. Exit codes are 0 success, 1 failed/inconclusive/incompatible evaluation or failed run, 2 invalid invocation/input.

Defaults are 3 warmups and 30 measured samples. First execution is separate, and does not claim a cold PostgreSQL cache. Database setup, clone/reset, input loading, serialization and correctness checks are outside application-call timers. Committed operations get a fresh clone for first execution, every warmup and every measured sample. Read cases share their trial database. Pure XIRR uses 100 calls per batch; recorded samples describe the whole batch. Overview/trend projection inputs are loaded before timing. Row IDs, amounts, flags and ordering remain in artifacts for comparison.

`smoke` uses 2 accounts/4 holdings/600 transactions. `typical`, `large-ledger`, `active-investor`, `long-history`, `multi-currency`, `transfer-heavy`, `shared-database`, and `large-portfolio` stress different dimensions. Overrides include accounts, connections, holdings, days, transactions, lots, users, anchor and strides; version 1 supports fixed seed 1. Deep-page reads require more than 10200 cash rows and are skipped in default smaller profiles; explicitly selecting an unsupported case fails before opening a database.

Use `--samples 1 --warmups 0 --profile smoke` for correctness smoke checks. These reports cannot pass performance goals. CI checks correctness only and applies no wall-time thresholds to shared runners. Raw artifacts are versioned JSON with atomic writes; schemas live in `benchmarks/`. Failed measurements retain completed samples and reasons.

To add a target, register its stable ID, suite, measurement boundary and reset policy in `backend/bench/src/catalog.rs`; prepare inputs outside the timer, call the real operation, then verify against persisted fixture inputs or a hand-calculated expectation. Add a corruption test that rejects plausible but incorrect output. SQL/RSS diagnostics are optional and separate from primary timing; absent metrics are null, never fabricated zeroes. Provider mapping, composition parsing and log throughput can be added with recorded inputs using the same contract.
