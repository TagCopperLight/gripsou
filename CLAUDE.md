# CLAUDE.md

gripsou is a self-hosted personal finance dashboard: connect bank/broker providers, sync accounts, holdings and transactions, and see net worth, its distribution and a budget over time. Single maintainer, single instance, real data (the Powens domain is named `gripsou-sandbox` but holds the user's real bank connections).

The code and migrations are the reference for *what* exists. This file only records what the code can't tell you: the principles, the invariants, and the decisions that look like mistakes but aren't.

## Workflow

Work is driven by GitHub issues on `TagCopperLight/gripsou` (public repo — anything pushed is published).

1. **Start from an issue.** Read it with `gh issue view <n> --comments`. If something is unclear, ask in the conversation before building.
2. **Work in a worktree** branched from an up-to-date `main`, on a branch named `<n>-<short-slug>` (e.g. `9-pairing-rework`), or just `<short-slug>` when there is no issue. Never work directly on `main`. A tool that creates the worktree for you may give the branch its own name: rename it with `git branch -m` before the first push, so the PR's branch carries the right name. Worktrees go under `.claude/worktrees/` (gitignored); from there the backend still finds the root `.env`. A fresh worktree needs `bun install` in `frontend/` and builds into its own `target/` (the first build is slow).
3. **Commit freely** on the branch, in whatever steps make sense.
4. **Before opening the PR**, `./ci.sh` must pass, and `.sqlx/` must be regenerated if any query changed.
5. **Open a PR** with `gh pr create`: the body says `Closes #<n>`, what changed and why in plain words, and how it was verified. Then stop. The user reviews and merges; never merge, and never push to `main`.
6. **Review feedback** goes in as new commits on the same branch.
7. **After the merge** GitHub deletes the remote branch. The local branch and its worktree are removed by `scripts/prune-merged.sh`, which the SessionStart hook in `.claude/settings.json` runs at the start of every session. It only touches branches with a merged PR and a clean worktree, and never the branch of the session running it.

Releases are the user's: never create tags or publish releases. Each `v*` tag triggers the Docker image build, and tagging a version goes with a manual production update. A draft release on GitHub collects the notes for the next version.

## Commands

Backend (`cd backend`, Cargo workspace; the binary is `gripsou` in `api`):
- `cargo run --bin gripsou` — serves the SPA and the JSON API on :8080, runs migrations on startup. Loads the root `.env`.
- `cargo test` / `cargo test -p gripsou-core <name>`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all`.

Frontend (`cd frontend`, **bun**): `bun run dev` (:5173, proxies `/api` → :8080), `bun run build`, `bun run lint`, `bun run test [pattern]`.

`./ci.sh` at the root runs exactly what CI runs (fmt, clippy, tests with `SQLX_OFFLINE=true`, frontend lint/test/build). Run it before calling work done. The one thing CI adds is speed-only: it pre-migrates its throwaway Postgres's `template1` (`cargo run --example migrate`) so each `#[sqlx::test]` database starts migrated. Don't do that to the local server: a migrated `template1` keeps the old checksum of a migration you are still editing.

Local stack: `docker compose -f docker/docker-compose.yml up -d postgres` (or `up --build` for everything). Always pass `-f`: the file pins `name: gripsou`, and the host has an unrelated compose project called `docker` whose `docker_pgdata` volume must never be touched.

### Database access from the host

The compose postgres has **no published port**, so `localhost:5432` does not work from the host even though `.env` says so (that value is for the containerised backend). Use the container IP:

```sh
export DATABASE_URL=postgres://gripsou:gripsou@$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' gripsou-postgres-1):5432/gripsou
```

`.env` is loaded by `cargo run` only (dotenvy, parent-directory search — never create `backend/.env`). `cargo test`, `cargo build` and the sqlx macros need `DATABASE_URL` exported in the shell.

### sqlx offline data

Queries are compile-time checked and CI builds offline from the committed `backend/.sqlx/`. After adding or editing any `query!`/`query_as!`/`query_scalar!` — in `src` **or** `tests` — regenerate it, or CI fails:

```sh
cd backend && cargo sqlx prepare --workspace -- --all-targets
```

`--all-targets` is required (test-only queries are skipped otherwise). Changing a comment *inside* a query string counts as a query change.

### Migrations are immutable

Never edit an applied migration, comments included: sqlx checksums each file and the app refuses to start against a database that ran the old version. Write a new migration instead.

Older migrations cite sections of design docs (`TRANSACTIONS.md §6.1`, `ARCHITECTURE.md §3.2`) that have since been deleted (`AUDIT.md` was never tracked and is gone for good). Read them from git history if needed: `git log --diff-filter=D --oneline -- TRANSACTIONS.md`, then `git show <commit>^:TRANSACTIONS.md`.

## Architecture

### The database is gripsou-shaped; providers map into it

Adding a provider must never need a migration. The crate split enforces this at compile time:

- `core` — canonical DTOs (`dto.rs`), the provider ports (`provider.rs`: `AccountProvider`, `PriceProvider`, `CompositionProvider`; `categorize.rs`: `Categorizer`), repositories, ingest, backfill, price/composition sync, and the budget pipeline (`budget/`).
- `providers` — adapters translating native payloads into canonical DTOs: `powens` (accounts), `yahoo` (prices and FX), `boursorama` (ETF composition), `gemini` / `jev` (budget categorisation). **Depends on `core`, never the reverse** — never import a provider's native types into `core`.
- `jobs` — the in-process tokio scheduler and sync orchestration (per-connection tasks, one lock each; the `CATEGORIZERS` registry).
- `api` — axum handlers, auth, routing, static files.

Provider weirdness is absorbed by the adapter, using `*_meta` JSONB columns and `external_id` (idempotent upserts), never by new columns. New account types are rows in `account_type`, not migrations.

### One holding model, one valuation path

- Everything owned is a `holding` of an `instrument`. A checking account is a holding of the `EUR` cash instrument (quantity = balance, price = 1). Cash is never special-cased.
- An FX rate is just a `price` of a cash instrument. Prices are stored in whatever currency the listing quotes; conversion happens at read time from the **price row's** currency, via `unit_value_asof` / `fx_asof`. Sums are in the hidden pivot (`app_settings.base_currency`), then divided once into the reader's `prefs.currency` by `reporting_fx_asof`. When that rate is missing it falls back to the pivot and `reporting_fx_degraded` says so — never show an unconverted figure under the chosen currency's symbol.
- `instrument` and `price` are global (shared by all users); everything else is user-scoped through `connection.user_id`.

### History: snapshots, backfill, lots

- **The core writes snapshots, not providers.** Every sync stamps `holding_snapshot` per holding (idempotent per day), so history exists even for a provider that only reports current balances.
- **Days without a snapshot are derived into `holding_backfill`** (`core/src/backfill.rs`) by walking transactions backward from the nearest *later* snapshot — never from today, so drift stays inside one gap. Priority: real snapshot > derived > held flat before the first transaction. Invariant: no backfill row for a day that has a snapshot (stamping deletes it). Each sync deletes and rebuilds the connection's whole backfill — simpler and always correct at this size.
- **`transaction` is the cash ledger and nothing else.** Purchases and sales are `lot` rows (`source` = `manual` | `provider`; only `manual` lots can be deleted by the user).
- **Cost basis comes from the `lot_basis` SQL function only** (fee-inclusive weighted average, plus the part of the position no lot explains). Never reimplement it elsewhere: it once existed in four copies across three languages that disagreed on screen, which is why the lot table exists.
- A holding whose lots don't explain its quantity gets a badge in the Holdings list and a modal to record the missing lots. For securities this is the main path, not a fallback (see Provider facts).

### Budget

Per-user categories (`budget_category`, seeded by a trigger on `users` insert) and tags on `transaction`.

- **Who may overwrite a category** is `category_source`: `user` > `pair` > `ai`. A user write is final; nothing automatic touches it again. An `ai` row with a null category is a deliberate abstention, not "uncategorised".
- **Pairing** (`budget/pairing.rs`) runs inside every ingest, in the same DB transaction, for the connection's owner. It links both halves of a transfer between the user's own accounts and files them as `internal_transfer`, except a half the user already filed in a neutral category, which keeps it. It is deliberately timid (mutual nearest match, 5-day window, ties pair nothing) because a false pair silently deletes real spending. Candidates are transfers whose category is still pairing's to decide, plus rows of any type (buy/sell aside) already filed in a neutral category: matching any other type on amount and date alone paired more coincidences than transfers on real data, and providers label some real transfers as deposits or card payments, so those wait for a neutral category.
- **The AI** (`budget/ai.rs`) runs after sync, once per user, only if the admin configured a provider *and* the user opted in. Its answers are never trusted: `decide` turns any guess outside the item's candidates (or a double answer) into an abstention. A guess into a `neutral` category is always sent to review, since it hides money from every total.
- **Every budget reader goes through `budget_transaction_rows` / `budget_transaction_matches`**, so the list, its counts, the review queue and "select all shown" bulk writes always agree on which rows exist. The cash leg of a buy/sell (`budget_investment_leg`) is left out: the lot is its record, and buying an ETF is not spending.
- A user write that files a paired row under a neutral category (Savings rather than Internal transfer) keeps the pair: no total changes. Any other category write, clearing included, unlinks it, so it is two-step: the server answers `pendingPairBreaks: n` and writes nothing until the client resends with `confirmBreakPairs: true`.

## Provider facts (settled — don't re-research)

- **Powens transactions are cash-only.** `/marketorders` is empty, investment rows carry no instrument, `id_category` is always 9998 (no categories). Lots and categories are gripsou's to build.
- **No aggregator exposes lots.** PSD2 providers can't see a PEA at all; Bridge models positions the same way as Powens and is sales-gated. The PEA's history only starts at its connection window, so net worth shows a known, unfixable dip before that; recording lots at their real dates keeps it small.
- Powens `last_update` returns *edited* rows, not new ones: every sync full-fetches and dedups on `external_id`.
- For investment accounts, Powens `balance` lags; the `XX-liquidity` investment line is the real cash.
- Loans and cards are skipped (they'd add to net worth with the wrong sign); `real_estate` deliberately falls through to `brokerage`.

## Product decisions

- No merchant logos, merchant notes or clickable descriptions — built and removed on purpose.

## Conventions

- **Money is `rust_decimal::Decimal` ↔ `NUMERIC`, never floats.** The API sends decimals as strings; the frontend formats them with the user's prefs through `Intl`.
- **Config split:** secrets and infra in env (see `.env.example`); admin-tunable values in the `app_settings` row (`cors_origins`, `enabled_providers`, `budget_ai_*`); per-user choices in `users.prefs`. Provider credentials are AES-GCM encrypted with `ENCRYPTION_KEY`.
- **Frontend:** React 19, TanStack Router (code-based tree in `router.tsx`) + Query, ECharts, react-i18next (en/fr in `src/i18n/` — every UI string in both). Pure logic lives in `src/lib/` with tests beside it.
- ESLint's `react-refresh/only-export-components` forbids exporting anything but components from a component file; put shared constants/types in a sibling `.ts`. `bun run build` won't catch it — run `bun run lint`.
- Vitest hides console output of passing tests when piped. To check for warnings (e.g. `act(...)`), run `bunx vitest run --reporter=verbose`.
- Tests: adapter mapping tests against recorded provider fixtures; integration tests against a real Postgres; Vitest for the frontend.
