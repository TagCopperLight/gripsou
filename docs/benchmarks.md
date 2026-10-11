# Application benchmarks

Use `scripts/bench list` to discover stable target IDs and `scripts/bench list --profiles` for fixture dimensions. Builds use release mode. The old `cargo run -p gripsou-jobs --example perf` remains available, but its debug timings are not comparable to this runner.

PostgreSQL must allow the supplied DATABASE_URL role to create databases. The URL supplies connection settings only: the runner creates migrated scratch databases from template0, freezes their business calendar at 2026-01-15, seeds synthetic data and closes a template before cloning trials. It never seeds the source database. Exact database names and ownership markers are recorded in a private temporary manifest. Normal errors and panics trigger cleanup; after an interrupted process use `scripts/bench cleanup /tmp/gripsou-bench-<run>.json`. Cleanup refuses names without a matching ownership marker.

```sh
scripts/bench run --profile typical --only transactions.search.common,transactions.page.first,transactions.page.deep,transactions.counts --transactions 20000 --save /tmp/baseline.json
# Make the optimization, then run the identical workload on the same machine.
scripts/bench run --profile typical --only transactions.search.common,transactions.page.first,transactions.page.deep,transactions.counts --transactions 20000 --save /tmp/candidate.json
scripts/bench compare /tmp/baseline.json /tmp/candidate.json
```

`compare` reports median and p95 timing changes for each target. It requires matching fixtures, parameters, sample counts and recorded environments, successful correctness checks, and identical semantic outcomes. It imposes no speed or noise thresholds; repeat runs when useful and assess the reported changes. Exit codes are 0 success, 1 incompatible comparison or failed run, 2 invalid invocation/input.

Defaults are 3 warmups and 30 measured samples. First execution is separate, and does not claim a cold PostgreSQL cache. Database setup, clone/reset, input loading, serialization and correctness checks are outside application-call timers. Committed operations get a fresh clone for first execution, every warmup and every measured sample. Read cases share their trial database. Pure XIRR uses 100 calls per batch; recorded samples describe the whole batch. Overview/trend projection inputs are loaded before timing. Row IDs, amounts, flags and ordering remain in artifacts for comparison.

`smoke` uses 2 accounts/4 holdings/600 transactions. `typical`, `large-ledger`, `active-investor`, `long-history`, `multi-currency`, `transfer-heavy`, `shared-database`, and `large-portfolio` stress different dimensions. Overrides include accounts, connections, holdings, days, transactions, lots, users, anchor and strides; version 1 supports fixed seed 1. Deep-page reads require more than 10200 cash rows and are skipped in default smaller profiles; explicitly selecting an unsupported case fails before opening a database.

Use `--samples 1 --warmups 0 --profile smoke` for correctness smoke checks. Raw artifacts are versioned JSON with atomic writes; schemas live in `benchmarks/`. Failed measurements retain completed samples and reasons.

To add a target, register its stable ID, suite, measurement boundary and reset policy in `backend/bench/src/catalog.rs`; prepare inputs outside the timer, call the real operation, then verify against persisted fixture inputs or a hand-calculated expectation. Add a corruption test that rejects plausible but incorrect output. SQL/RSS diagnostics are optional and separate from primary timing; absent metrics are null, never fabricated zeroes. Provider mapping, composition parsing and log throughput can be added with recorded inputs using the same contract.

## HTTP and browser suites

Select `--suite http` for authenticated loopback requests using the production router and a reused client. The interval ends after the complete decoded response body is received; response validation stays outside it. No scheduler runs and fixture providers are disabled.

Install browser prerequisites with `cd frontend && bun install --frozen-lockfile && bun x playwright install chromium` (on a fresh Linux runner, use `bun x playwright install --with-deps chromium`). `--suite browser` builds the production frontend before any measured work. Playwright is pinned in package.json and bun.lock. `bun run bench:readiness` verifies pending-request, skeleton, wrong-amount and unfinished-chart rejection; `bun run bench:typecheck` checks the standalone driver.

Browser contexts use 1440×900, English, Europe/Paris and a fixed business-date offset. `performance.timeOrigin + performance.now()` carries a continuous timer across document navigation; Date does not control it. Fresh readiness samples create a context per trial. Cached-return and repeated-navigation cases pre-load pages in the same context outside timing. Search/filter/modal/pagination/range inputs are prepared outside timing. Readiness requires the declared API responses, semantic DOM, no visible loading placeholders and all mounted charts' actual finished events. A synchronous zero-data chart uses its animation completion state. Normal chart animations remain enabled. The lots-dialog case creates a declared one-share gap in its own trial fixture so the existing record-history control is available.

Browser outcomes retain observed API bodies and action state. Rust checks those bodies against persisted cash, lot, account and FX inputs; the browser checks rendered transaction identities, order, accounts and amounts, including filtered and paginated results. The lots dialog waits for the preview of its complete seeded rows. Backfill verifies actual derived coverage, quantities and values and records a deterministic state hash.

Sessions use real wall-clock expiration, are transmitted only through private child stdin, and never enter result JSON. Rust owns server/database cleanup; the browser driver closes contexts/browser on ordinary failures. Child exit/schema/identity/sample-count checks prevent empty or malformed successful reports. Browser version, build fingerprint, cache policy and timer method accompany results; long-task/frame observations are diagnostic, process memory is unsupported rather than invented.

## Concurrent scenarios and diagnostics

`--suite load` offers 100 requests per measured trial. `--concurrency` controls client capacity; pool saturation uses 20 clients against the application's pool of 10. Run mixed-read comparisons with concurrency 1, 5, 10 and 20. Fixed-work requests are scheduled together and their latency includes client/pool queuing. Fixed-duration offers run at 10 requests/second over a 10-second window, with a bounded queue of twice client concurrency and explicit rejection counts. Scenario timeout is 120 seconds. Requested capacity and observed peak are separate fields. The current scheduled-to-completed boundary also includes correctness validation and is labeled as such; do not compare it with receipt-only HTTP timings.

Different-user ingestion requires `--users 2` or `shared-database`; same-user ingestion requires at least two connections. For an all-target smoke selection use `--profile smoke --connections 2 --users 2`. Background scenarios prove interval overlap; absence of overlap, deadlocks, request failures and timeouts fail the run. Per-request scheduled/submitted/completed offsets, status, queue-inclusive latency and scenario wall time are preserved in diagnostics. Never sum overlapping latencies to infer elapsed wall time. Background workloads get a separate `<target>.background` measurement with actual background trial durations, including advisory-lock waits.

`--diagnostics` runs an additional reset clone after score samples. A subscriber scoped to the actual backend operation counts sqlx::query events; setup and oracle queries are excluded, and the production global subscriber is untouched. SQL plans are supported for the explicitly equivalent holding-price query only. Other targets report unsupported plan data. EXPLAIN ANALYZE BUFFERS runs on the separate clone, never on the source database or inside score timing. RSS/peak RSS describe the Rust benchmark/application process only, excluding PostgreSQL and Chromium, observed through Linux /proc/self/status. Missing platform/event/plan support is null with a reason. Add equivalent SQL and an equivalence test before exposing a new plan diagnostic.

Keep baseline/candidate measurements on the same controlled host for optimization assignments.
