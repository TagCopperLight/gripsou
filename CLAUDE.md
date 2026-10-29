# CLAUDE.md

gripsou: a self-hosted personal finance dashboard (bank/broker providers → accounts, holdings, transactions → net worth, distribution, budget over time). One maintainer, one instance, real data: the Powens domain `gripsou-sandbox` holds the user's real bank connections.

The code is the reference for *what* exists. This file records what it can't tell you: principles, invariants, and decisions that look like mistakes but aren't.

## Workflow

Work comes from GitHub issues on `TagCopperLight/gripsou`. The repo is public, so anything pushed is published.

1. Read the issue with `gh issue view <n> --comments`. Ask before building if anything is unclear.
2. Work in a worktree under `.claude/worktrees/` (gitignored), branched from an up-to-date `main`. Name the branch `<n>-<short-slug>`, or `<short-slug>` when there's no issue. If a tool picked the name, `git branch -m` it before the first push. A fresh worktree needs `bun install` in `frontend/`, and its first build is slow (own `target/`).
3. Commit freely. Before the PR, `./ci.sh` must pass, and `.sqlx/` must be regenerated if any query changed.
4. `gh pr create`: the body has `Closes #<n>`, what changed and why in plain words, and how it was verified. Then stop. Never merge, never push to `main`. Review feedback goes in as new commits.
5. Merged branches and their worktrees are pruned by `scripts/prune-merged.sh` (SessionStart hook).

Never create tags or releases: a `v*` tag builds the Docker image and goes with a manual production update.

## Commands

- **Backend** (`cd backend`, the binary is `gripsou` in `api`): `cargo run --bin gripsou` serves the SPA and API on :8080, runs migrations, and loads the root `.env`. Also `cargo test [-p gripsou-core <name>]`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all`.
- **Frontend** (`cd frontend`, **bun**): `bun run dev` (:5173, proxies `/api` → :8080), `build`, `lint`, `test [pattern]`.
- **`./ci.sh`** runs exactly what CI runs. Its backend tests use a throwaway Postgres container whose `template1` it migrates first, so each `#[sqlx::test]` starts migrated. Never migrate the dev server's `template1`: it would keep the old checksum of a migration you're still editing.
- **Local stack:** `docker compose -f docker/docker-compose.yml up -d postgres` (or `up --build`). Always pass `-f`: the host has an unrelated compose project `docker` whose `docker_pgdata` volume must never be touched.

### Database from the host

The compose postgres publishes no port, so `.env`'s `localhost:5432` only works inside containers. Use:

```sh
export DATABASE_URL=postgres://gripsou:gripsou@$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' gripsou-postgres-1):5432/gripsou
```

Only `cargo run` loads `.env` (it searches parent directories; never create `backend/.env`). `cargo test`, `cargo build` and the sqlx macros need `DATABASE_URL` exported.

### sqlx and migrations

- CI builds offline from `backend/.sqlx/`. After touching any `query!`/`query_as!`/`query_scalar!` (in `src` or `tests`, comments inside the query included), run `cd backend && cargo sqlx prepare --workspace -- --all-targets`. Without `--all-targets`, test queries are skipped.
- **Never edit an applied migration**, comments included: the app refuses to start on a checksum mismatch. Write a new one.

### Review server (mock mode)

`cd frontend && bun run dev:mock --port 5180 --strictPort` runs the SPA with no backend, for looking at and reviewing UI. A Vite plugin (`mock/plugin.ts`) answers `/api/*` from an in-memory store of made-up data. Never put real data in it.

- `mock/data/` builds the dataset, `mock/store.ts` holds it, `mock/routes/*.ts` answer the API (`reply(status, body)` for errors), `mock/views/` compute what the server would. Writes change the store. A missing route is a 404 in the app.
- `mock/states.ts` lists named tweaks of the data, each tagged with the UI pieces it affects. The panel in the page shows the states of the piece named by `FOCUS`, plus language, currency and role, and can make any path fail or hang (`/__mock/override`). Add a state when a screen needs one; don't build a general scenario system. Active states persist in `node_modules/.cache/gripsou-mock-states.json`.
- Conventions: any credentials sign in except the password `wrong`; `@taken.example` emails are taken; `/invite/expired` is a dead link; `/reset/reset…` is a reset link.
- Vite restarts on changes under `mock/`. If a change to the base data doesn't show, restart it yourself.

## Architecture

### The database is gripsou-shaped; providers map into it

Adding a provider must never need a migration. The crates enforce it:

- `core`: canonical DTOs (`dto.rs`), provider ports (`provider.rs`, `categorize.rs`), repositories, ingest, backfill, price/composition sync, budget (`budget/`).
- `providers`: adapters from native payloads to canonical DTOs: `powens` (accounts), `yahoo` (prices, FX), `boursorama` (ETF composition), `jev` (categorisation). They depend on `core`, never the reverse.
- `jobs`: the in-process tokio scheduler and sync orchestration (one task and one lock per connection; the `CATEGORIZERS` registry).
- `api`: axum handlers, auth, routing, static files.

Provider quirks belong in the adapter, the `*_meta` JSONB columns and `external_id` (idempotent upserts), never in new columns. A new account type is a row in `account_type`.

### One holding model, one valuation path

- Everything owned is a `holding` of an `instrument`. A checking account holds the `EUR` cash instrument (quantity = balance, price = 1). Cash is never special-cased.
- An FX rate is a `price` of a cash instrument. Prices are stored in the listing's currency and converted at read time from the price row's currency (`unit_value_asof` / `fx_asof`).
- Sums are computed in the pivot `app_settings.base_currency`, then divided once into the reader's `prefs.currency` (`reporting_fx_asof`).
- A currency change fetches that rate before saving, and is refused if no rate can be had (`update_prefs`, `price_sync::ensure_fx_rate`). So readers assume the rate exists. Never show an unconverted figure under the chosen currency's symbol. `reporting_fx_degraded` is unused.
- `instrument` and `price` are global. Everything else belongs to a user through `connection.user_id`.

### History

- **The core writes snapshots, not providers.** Every sync stamps `holding_snapshot` per holding (idempotent per day), so even a balance-only provider builds history.
- **A snapshot is dated when the provider last read the bank** (`CanonicalAccount.balance_as_of`, else today), not when gripsou synced. A provider that can't reach the bank keeps returning old balances; dated today they would be false anchors hiding the real history. During an outage the chart holds the last real point, and the backfill rebuilds the stretch once the provider catches up (#58).
- **Days without a snapshot are derived into `holding_backfill`** (`core/src/backfill.rs`). It walks transactions backward from the nearest *later* snapshot, never from today, so drift stays inside one gap.
  - Priority: snapshot > derived > held flat before the first transaction.
  - There is never a backfill row on a snapshot day: stamping deletes it.
  - Each sync rebuilds the connection's whole backfill.
- **`transaction` is the cash ledger only.** Purchases and sales are `lot` rows (`source` is `manual` or `provider`; users can delete only `manual` ones).
- **Cost basis comes only from the `lot_basis` SQL function** (fee-inclusive weighted average, plus the part of the position no lot explains). Never reimplement it: a second copy drifts apart and the screens disagree.
- A holding whose lots don't explain its quantity gets a badge and a modal to record the missing lots. For securities this is the main path (see Provider facts).

### Budget

Categories are per user (`budget_category`, seeded by a trigger on `users` insert). Tags live on `transaction`.

- **`category_source`** decides who may overwrite a category: `user` > `pair` > `ai`. A user write is final. An `ai` row with a null category is a deliberate abstention.
- **Pairing** (`budget/pairing.rs`) runs in every ingest's DB transaction. It links both halves of a transfer between the user's own accounts as `internal_transfer`, except a half the user already filed under a neutral category.
  - It recomputes all pairs and writes only the difference. User corrections apply at the next sync. A pair no longer found is undone, and its pairing-set halves go back to uncategorised.
  - It is deliberately timid (mutual nearest match, 5-day window, ties pair nothing), because a false pair silently deletes real spending.
  - Candidates are transfers still pairing's to decide, plus rows of any type except buy/sell that are already in a neutral category. Matching other types on amount and date alone paired coincidences, and providers mislabel some transfers.
- **The AI** (`budget/ai.rs`) runs after sync, once per user, only if the admin configured a provider *and* the user opted in. Its answers are never trusted: `decide` turns a guess outside the item's candidates (or a double answer) into an abstention, and a guess into a `neutral` category always goes to review, since it hides money from every total.
- **Every budget reader goes through `budget_transaction_rows` / `budget_transaction_matches`**, so the list, counts, review queue and "select all shown" agree. The cash leg of a buy/sell (`budget_investment_leg`) is excluded: the lot is its record.
- Filing a paired row under a neutral category keeps the pair (no total changes). Any other category write, clearing included, unlinks it, in two steps: the server answers `pendingPairBreaks: n` and writes nothing until the client resends with `confirmBreakPairs: true`.

## Provider facts (settled, don't re-research)

- **Powens transactions are cash-only.** `/marketorders` is empty, investment rows have no instrument, and `id_category` is always 9998. Lots and categories are gripsou's job.
- **No aggregator exposes lots.** PSD2 providers can't see a PEA, and Bridge is like Powens and sales-gated. The PEA's history starts at its connection window, so net worth shows a known, unfixable dip before that. Lots recorded at their real dates keep it small.
- An account's `last_update` field is when Powens last read it at the bank. It stops moving while the bank is unreachable, so it dates the snapshots, whatever error state Powens reports.
- Powens `last_update` returns *edited* rows, not new ones. Every sync full-fetches and dedups on `external_id`.
- **Powens datetimes without a timezone are `Europe/Paris` local time, not UTC** (#38). Date-only fields (`date`, `rdate`, `vdate`) are already Paris days: keep them as dates. If a feature needs exact instants, add one shared parser in the Powens adapter using Paris rules, tested across DST changes, including ambiguous and nonexistent times. Never assume UTC or a fixed offset.
- For investment accounts, Powens `balance` lags. The `XX-liquidity` investment line is the real cash.
- Loans and cards are skipped (wrong sign for net worth). `real_estate` deliberately falls through to `brokerage`.

## Product decisions

- No merchant logos, merchant notes or clickable descriptions: they were built and removed on purpose.

## Conventions

- **Write about what is, never what was.** Comments, docs, config examples and UI text describe the current state. No pointers to where something used to live, no "moved to", "no longer", "now", "previously". Git history records the past. (Product decisions above are the exception: they exist to stop a removed thing from being rebuilt.)
- **Money is `rust_decimal::Decimal` ↔ `NUMERIC`, never floats.** The API sends decimals as strings. The frontend formats them with the user's prefs through `Intl`.
- **Config:** secrets and infra in env (`.env.example`), admin-tunable values and provider keys in `app_settings` (keys in `provider_config`), per-user choices in `users.prefs`. Provider credentials are AES-GCM encrypted with `ENCRYPTION_KEY`.
- **Frontend:** React 19, TanStack Router (code-based tree in `router.tsx`) + Query, ECharts, react-i18next. Pure logic lives in `src/lib/`, with tests beside it.
- **Translations:** every UI string is in both `src/i18n/en.json` and `fr.json`. Review added or changed text in both languages for natural phrasing and consistent terms. Keep placeholders, plural keys and rich-text tags. API key field labels are not translated: each provider declares them in its own words (`ConfigField.label`).
- **Exports:** a component file exports only components (`react-refresh/only-export-components`). Put shared constants and types in a sibling `.ts`. Only `bun run lint` catches this, not `build`.
- **Warnings:** to see a passing test's warnings (e.g. `act(...)`), run `bunx vitest run --reporter=verbose`.
- **Tests:** adapters against recorded fixtures, integration against a real Postgres, Vitest for the frontend.
- **Frontend tests pin behaviour, not code.** Write one only if it can fail for a reason a user would notice (an edge case, a computed figure, a regression, an exact request to the server). Not: props rendering, static strings, callbacks, URLs, CSS classes, constants, the same case twice (a `lib/` helper and its component), or the formula restated as the expected value.

## Logs

Info-and-above lines from gripsou's crates are printed *and* saved to the `log` table (90 days, daily `logs` sweep). Library lines and debug are terminal-only. The writer drops lines rather than slow the app, and logs `log lines dropped` when it does.

- **Message:** a fixed lowercase phrase (`sync finished`); every variable is a field, reusing the existing field names (`connection_id`, `user_id`, `outcome`…).
- **Levels:** error = someone must look or work was lost; warn = degraded but recovered; info = something happened; debug = routine, not saved.
- **Errors:** `error = %gripsou_core::logs::error_chain(&e)`, logged once, where handled.
- **Never log** passwords, credentials, tokens, invite/reset links, OAuth codes, raw provider bodies, amounts or merchant names. Log `user_id` once the user is known. Log an email only at the password step.
- **Spans** (`sync`, `ai_run`, `sweep`, `request`) carry the operation's ids. Spawned work must be `.instrument(...)`-ed or it loses them.
- **Installing:** use `gripsou_core::logs::install`, never `.init()`. `.init()` adds the `log`-crate bridge, whose per-query checks made the filters drop the next line (pinned by `core/tests/logs_install.rs`).
- **UUIDs:** the terminal cuts them to 8 characters. The saved log keeps them whole, so match with `like '1fe32d5a%'`.
- **Tests on saved logs:** capture with `gripsou_core::logs::capture(capacity)`.
- **Sync history is the `sync finished` lines**, one per sync (shape pinned by `jobs/tests/sync_log.rs`; change both together). A panicking or 30-minute-timeout sync still gets one (`failed_step` `panic` / `timeout`); one cut off by a restart doesn't, so the history isn't guaranteed complete.

```sql
-- One connection's sync history
select at, fields->>'trigger' trigger, fields->>'outcome' outcome, fields->>'failed_step' step,
       fields->>'error' error, (fields->>'duration_ms')::int ms, fields->>'transactions_inserted' new_txns
from log where message = 'sync finished' and fields->>'connection_id' = '<uuid>' order by at desc limit 50;
-- Everything one sync logged
select at, level, message, fields from log where fields->>'sync_id' = '<uuid>' order by id;
-- Errors of the last 7 days
select at, target, message, fields from log where level = 'error' and at > now() - interval '7 days' order by at desc;
```
