# Running benchmarks

Benchmarks measure how long the app takes to do specific jobs, such as loading
holdings, searching transactions or opening the dashboard. Use them before and
after a change to see whether the app got faster.

The runner creates temporary databases filled with fake financial data. It does
not change your normal app database or contact your bank. You do not need to
start the app yourself.

## 1. Set up

Run the commands below from the repository root. You need Rust and a running
PostgreSQL server. HTTP benchmarks also start a temporary server themselves.
Browser benchmarks additionally need Bun and Chromium; their setup is below.

The runner reads `DATABASE_URL` from your shell or the root `.env`. The database
user must be allowed to create databases.

If you use this project's Docker database, start it and use its container IP
because its PostgreSQL port is not exposed to the host:

```sh
docker compose -f docker/docker-compose.yml up -d postgres
export DATABASE_URL="postgres://gripsou:gripsou@$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' gripsou-postgres-1):5432/gripsou"
```

`scripts/bench` builds and runs the benchmark program in release mode. The first
command can take a while because Rust has to compile it.

## 2. Try one small benchmark

```sh
scripts/bench run --profile smoke --only portfolio.holdings --samples 1 --warmups 0 --save /tmp/holdings.json
```

This creates a small fake portfolio, measures loading its holdings with one
reported sample, checks that the result is correct, and saves the measurements
to `/tmp/holdings.json`. Temporary databases are deleted when it finishes.

This is a quick setup check. One measurement is too little to judge an
optimization.

## 3. Measure before and after a change

First, record the current code:

```sh
scripts/bench run --profile typical --only portfolio.holdings --save /tmp/before.json
```

Make your change, then run the same benchmark:

```sh
scripts/bench run --profile typical --only portfolio.holdings --save /tmp/after.json
scripts/bench compare /tmp/before.json /tmp/after.json
```

By default, each benchmark runs once initially, then 3 times to warm up, then
30 times for the reported measurements. Database creation and fake-data setup
are outside the timer.

Keep both runs on the same machine, use the same options, and avoid other heavy
work while they run. For small improvements, repeat the experiment: normal
variation can look like a speedup.

### Reading the results

A run prints a line like this (example numbers):

```text
portfolio.holdings median 12.000 ms p95 18.000 ms (30 samples)
```

- **Median** is the middle measurement: half the runs were faster and half slower.
- **p95** describes the slower end: about 95% of measurements were at or below it.
- **ms** means milliseconds. Lower is faster.

`compare` prints JSON. For each benchmark it gives the before and after times,
plus `delta_percent`. **Negative means faster**: going from 12 ms to 9 ms is
`-25`, a 25% reduction in time. Positive means slower.

Look at `compatible` first. If it is `false`, `reasons` explains why the comparison
is unreliable—for example, different data sizes, settings, environments or
returned results. Fix that difference and rerun before judging the timings.

The saved JSON files contain the individual measurements and enough information
to check that the two runs did the same work. You do not need to edit them.
There is no required speedup or automatic performance pass/fail threshold.
An operation that returns incorrect data fails the benchmark even if it is fast.

## Choose what to measure

```sh
scripts/bench list
```

This lists the available benchmark names, grouped by the kind of work they do.
Pass one name, or several separated by commas, to `--only`. Without `--only`,
the runner selects all supported benchmarks in the chosen group; that can take
much longer.

| Group (`--suite`) | What it measures | When to use it |
| --- | --- | --- |
| `backend` (default) | An internal operation, including database access when needed | Optimize queries, history rebuilding or transaction processing |
| `http` | An authenticated API request, through receiving the response | Measure the cost of an endpoint |
| `browser` | A page load or interaction, until its data and charts are ready | Measure what a user waits for |
| `load` | Work happening at the same time, including waiting in queues | Check how reads behave during sync or under several clients |

For example, measure transaction searches against 100,000 fake transactions:

```sh
scripts/bench run --profile large-ledger --only transactions.search.common,transactions.search.rare --save /tmp/search.json
```

Or measure the holdings API:

```sh
scripts/bench run --suite http --profile typical --only http.holdings --save /tmp/http.json
```

Times from different groups measure different work. Compare the same benchmark
before and after a change.

### Choose the fake data

`--profile` picks a predefined dataset. Start with `typical`; use a larger or
more specialized dataset when it matches the problem you are investigating.

| Profile | What it represents |
| --- | --- |
| `smoke` | Small setup check: 2 accounts, 4 holdings, 600 transactions |
| `typical` | 6 accounts, 13 holdings, 5,000 transactions, 1,300 days of history |
| `large-ledger` | 100,000 transactions |
| `active-investor` | Many securities and buy/sell lots |
| `long-history` | 10 years of history, including missing prices |
| `multi-currency` | EUR, USD and GBP holdings |
| `transfer-heavy` | Many transfers between accounts |
| `shared-database` | 100 users sharing the database |
| `large-portfolio` | 40 accounts and 500 holdings |

You can override a size, for example `--transactions 20000` or `--days 3650`.
Use the same overrides for both runs. `transactions.page.deep` needs more than
10,200 transactions; choose `large-ledger` or increase `--transactions`.

## Browser benchmarks

Install the browser once:

```sh
(cd frontend && bun install --frozen-lockfile && bun x playwright install chromium)
```

If Chromium reports missing system libraries on Linux, install them with
`(cd frontend && bun x playwright install --with-deps chromium)`.

Then measure the dashboard:

```sh
scripts/bench run --suite browser --profile typical --only browser.dashboard.ready --save /tmp/dashboard.json
```

The runner builds the frontend and opens Chromium itself. Timing ends when the
expected data is visible, loading placeholders are gone and chart animations
have finished. Building the frontend and launching the browser are outside that
timer. Use the before/after steps above to compare a frontend change.

## Concurrent work

For example, measure dashboard requests while history is being rebuilt:

```sh
scripts/bench run --suite load --profile typical --only load.dashboard-during-backfill --save /tmp/load.json
```

Load timings include time spent waiting for a free connection and checking the
response. The background task's duration is reported separately.

To run the whole load group on a small dataset, supply two users and connections
so the sync scenarios have enough data:

```sh
scripts/bench run --suite load --profile smoke --users 2 --connections 2 --samples 1 --warmups 0 --save /tmp/load-check.json
```

For mixed-read scenarios, `--concurrency 5` means up to five clients at once.
The pool-saturation scenario always uses 20 clients to stress the database pool.

## If a run is interrupted

Ordinary failures clean up temporary databases. If the process is killed before
cleanup finishes, it can leave a file named `/tmp/gripsou-bench-<run>.json`.
That file records which temporary databases belong to the run.

With `DATABASE_URL` set as before, clean up that specific run:

```sh
scripts/bench cleanup /tmp/gripsou-bench-<run>.json
```

Replace `<run>` with the ID from the actual filename. This is a cleanup record,
not a benchmark result file such as `/tmp/before.json`.

## Using the web interface

`tools/bench-ui` is a small local web page to launch benchmarks with progress
bars and compare saved runs with charts. It runs the same `scripts/bench`
commands as above, on the code currently on disk.

```sh
(cd tools/bench-ui && bun install && bun run start)
```

Open <http://127.0.0.1:5174>. It uses `DATABASE_URL` from your shell, or finds
the Docker database by itself. Results are saved in `benchmarks/results/`
(ignored by git); result files made with `--save` can be copied there too.

## Optional investigation tools

Add `--diagnostics` when you need more clues about a backend operation. It runs
extra checks separately from the timing measurements and saves details in the
result JSON: SQL query counts, memory used by the Rust process, and a query plan
where supported. Memory figures exclude PostgreSQL and Chromium. Unsupported
information is marked as unavailable.

To add a new benchmark, start with `backend/bench/src/catalog.rs` and the existing
implementations in that crate. Give it a name, call the real app operation, and
check its result against the fake data. Keep setup outside the timer and include
a test proving that an incorrect result is rejected.
