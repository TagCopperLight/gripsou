# gripsou — Architecture

> Self-hosted personal finance dashboard. Connect bank/broker/crypto providers,
> sync transactions and holdings, and see net worth and its distribution over time.
>
> This document is the source-of-truth design. The guiding principle throughout:
> **the database is shaped around gripsou's domain; providers map _into_ it.**
> Nothing in the schema is provider-specific. Adding a provider must never require
> a schema migration.

---

## 1. Goals & constraints

- **Provider-agnostic core.** Powens is the first provider, but the model must hold
  banks, brokers, and crypto from any future source behind a stable interface.
- **Accurate money & time series.** Exact decimals (no floats); net worth and PnL
  legible across ranges from 24h to max.
- **Self-hostable by non-experts.** A short `docker compose up` with as few moving
  parts as is reasonable.
- **Single maintainer.** Favor a small, uniform model over many special cases.

### Explicit non-goals for v1 (YAGNI)

Designed _around_ but not _built_ now: manual account entry, 2FA, ETF
country/sector breakdowns. The model leaves room for each without rework.
Multi-currency conversion and the Transactions list, once in this list, have
since shipped (§11, §12).

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite** (TypeScript), static SPA | Auth-gated dashboard; no SSR/SEO need; compiles to static files, no Node in production |
| Routing / data | **TanStack Router** + **TanStack Query** | Type-safe routes; Query fits the sync-and-display model and sync-status polling |
| Charts | **ECharts** | One lib covers line, pie, stacked-area, sparklines, and intraday/financial; themeable dark |
| i18n / format | **react-i18next** + **`Intl`** with explicit options | en/fr strings; free-form, composable number/date formatting |
| Backend | **Rust** — axum + tokio | Single static binary, trivial self-host, strong correctness, async sync jobs + in-process scheduler |
| DB access | **sqlx** + **rust_decimal** | Compile-time-checked SQL; exact money ↔ `NUMERIC` |
| Database | **PostgreSQL** | Native `NUMERIC`, `timestamptz`, JSONB escape-hatch; snapshot/price tables promotable to TimescaleDB later |
| Auth (v1) | **argon2** + short-lived bearer token | Minimal; login every time (see §8) |
| Packaging | **Docker Compose** | `backend` (serves SPA + API) + `postgres` |

### High-level shape

```
Browser (React SPA, static)
      │  HTTPS / JSON  (Bearer token)
      ▼
Rust API (axum) ───────────────► PostgreSQL  (canonical model)
   │        ▲                          ▲
   │ scheduler / on-demand sync        │ core writes snapshots
   ▼        │                          │
Provider adapters ────────────────────┘
  ├─ AccountProvider:  Powens (banks, PEA, brokerage), Manual (future)
  ├─ PriceProvider:    market data (intraday + historical backfill)
  └─ Categorizer:      Gemini, Jev (budget AI categorisation, optional)
```

---

## 3. Data model

Domain-first. Cash and securities are **unified**: everything you own is a
`holding` of an `instrument`. A checking account is internally a holding of the
`EUR` currency-instrument (quantity = balance, price = 1). This yields one
snapshot table, one valuation path, and a Holdings list (Cash included) that
falls out for free.

### 3.1 Entity-relationship overview

```
user ─1∞─ connection ─1∞─ account ─1∞─ holding ─∞1─ instrument
                                   │              │
                                   │              └─1∞─ price
                                   ├─1∞─ holding_snapshot   (★ net-worth source)
                                   └─1∞─ transaction ─∞1─ budget_category?
                                                  │ └─∞∞─ budget_tag
                                                  └─ transfer_pair_id → transaction
holding ─1∞─ lot   (buy/sell records: the "capital invested" staircase)
account ─∞1─ account_type
user ─1∞─ invite_token
user ─1∞─ budget_category, budget_tag, budget_ai_run;  user ─1─ budget_ai_lock?
```

`instrument` and `price` are **global / shared across users** (one `EUR`, one
`AAPL` for everybody); everything else is user-scoped via `connection.user_id`.

### 3.2 Tables

Conventions: PK `id` is `uuid` (or `bigint` identity) unless noted; `*_at` are
`timestamptz`; money is `NUMERIC`; provider-specific extras live in `*_meta`
JSONB; `external_id` enables idempotent provider upserts.

#### Identity & access

**users**
- `id`, `email` (unique), `name`, `password_hash`, `role` (`admin` | `user`)
- `prefs` (JSONB): `ui_language`, `date_format`, `number_decimal_sep`,
  `number_group_sep`, `number_decimals`, `currency_symbol`,
  `currency_position` (`before` | `after`), `percent_decimals` — all independent;
  plus `currency` (reporting currency), `privateMode`, and the budget prefs
  `showChecked`, `budgetAiEnabled` (the user's AI opt-in, off by default) and
  `budgetAiThreshold` (review threshold in percent, 50–95, default 70)
- `created_at`

**invite_token**
- `id`, `token` (random, unique), `type` (`invite` | `reset`)
- `email` (nullable), `created_by` → users.id, `expires_at` (24h), `used_at`

**session**
- `id`, `user_id` → users.id (cascade), `token_hash` (sha256, unique)
- `user_agent` (nullable), `ip` (nullable), `remembered`, `created_at`,
  `last_active_at`, `expires_at`

**app_settings** (singleton row)
- `cors_origins` (text[]), `enabled_providers` (text[]),
  `base_currency` (not null, default `EUR`) — the pivot FX rates are stored
  against. Never exposed in the UI; every figure is divided into the reading
  user's `prefs.currency` by `reporting_fx_asof()`. That preference is itself a
  rate-eligible currency — the price pass fetches its pair even though nothing
  is held or quoted in it — and when no rate exists yet `reporting_fx_asof`
  falls back to the pivot while `reporting_fx_degraded()` (0026) says so, so an
  unconverted figure is never shown wearing the chosen currency's symbol.
- Budget AI (0029/0030): `budget_ai_provider` (nullable; null = AI off for the
  whole instance), `budget_ai_model` (nullable; null = the adapter's default),
  `budget_ai_prices` (JSONB, admin-entered USD per million tokens keyed by the
  run log's `provider:model`, decimal strings: `{ "<model>": { "in": "0.10",
  "out": "0.40" } }`) — see §12.7.

**provider** (registry / reference)
- `key` (PK, e.g. `powens`), `display_name`, `kind` (`account` | `price`),
  `enabled`

#### Connections & accounts

**connection**
- `id`, `user_id` → users.id, `provider_key` → provider.key
- `display_name`, `status` (`ok` | `syncing` | `error`),
  `last_sync_at`, `last_error`
- `credentials` (JSONB, **encrypted at rest**), `provider_meta` (JSONB)
- `created_at`

**account**
- `id`, `connection_id` → connection.id (**nullable** = manual, future)
- `name` (user-editable), `color` (user-editable), `currency`
- `type_key` → account_type.key, `provider_meta` (JSONB)
- `external_id`, `created_at`

**account_type** (reference — extensible by data insert, not migration)
- `key` (PK: `checking`, `savings`, `pea`, `brokerage`, `life_insurance`,
  `retirement`, `crypto`), `label`

There is no separate category table. It existed, seeded 1:1 with `account_type`,
and was dropped in `0013` because the hierarchy carried no information.
Liabilities (`loan`, `card`) are skipped at the adapter rather than typed; they
get their own types when net worth becomes assets − liabilities.

#### Positions & instruments

**instrument** (global)
- `id`, `kind` (`cash` | `equity` | `etf` | `crypto` | …)
- `symbol`, `isin` (nullable), `name`, `logo_url`, `currency`
- `meta` (JSONB — sector/country distributions, future)
- Unique on a natural identifier per kind (e.g. `isin`, or `(kind, symbol)`);
  one `cash` instrument per currency

**holding** (current position)
- `id`, `account_id` → account.id, `instrument_id` → instrument.id
- `quantity` (NUMERIC), `cost_basis` (NUMERIC, total invested)
- `updated_at`; **unique `(account_id, instrument_id)`**

**holding_snapshot** ★ — source of truth for net-worth-over-time
- `id`, `holding_id` → holding.id, `as_of` (date or timestamptz)
- `quantity`, `value` (valuation at snapshot), `cost_basis`
- Written **by the core** after every sync; idempotent on `(holding_id, as_of)`
  (re-sync overwrites the day). Promotable to a TimescaleDB hypertable.

**price** ★ — per-instrument price series (intraday + backfill)
- `id`, `instrument_id` → instrument.id, `ts` (timestamptz)
- `unit_price` (NUMERIC), `currency`
- **Unique `(instrument_id, ts)`**. Populated by PriceProviders; daily points
  also derivable from snapshots. Promotable to a hypertable.

#### Activity

**transaction** — the cash ledger and nothing else (0024 dropped
`instrument_id`, `quantity` and `unit_price`: no provider sends them, and the
hand-entered purchases moved to `lot`).
- `id`, `account_id` → account.id
- `ts` (the provider's operation date), `booked_on` (date, nullable — the day
  the bank moved the money; read through `txn_day()` by the backfill)
- `type` (`deposit` | `withdrawal` | `buy` | `sell` | `dividend` | `fee`
  | `interest` | `transfer`), `amount` (signed cash impact), `fee` (nullable)
- `description` (trigram-indexed), `description_norm` (generated, see §12.1)
- `external_id` (dedup), `provider_meta` (JSONB)
- Budget columns (0028, see §12.1): `budget_category_id`, `category_source`,
  `category_confidence`, `category_reviewed_at`, `checked_at`,
  `transfer_pair_id`

**lot** — one buy or sell of a holding: `holding_id`, `side`, `acquired_on`,
`quantity`, `unit_price`, `fee`, `source` (`manual` | `provider`),
`external_id`, `meta`. Lots are the "capital invested" staircase. A provider
buy/sell on a PEA is the cash leg of a lot and is hidden from every budget
reader (`budget_hidden_pea_leg`).

### 3.3 How each UI element maps onto the model

| UI element | Source |
|---|---|
| Net-worth chart (24h…max) + capital invested | `holding_snapshot` anchors qty/cost; × `price(t)` intraday → Σ. Invested = Σ `cost_basis` over time |
| Account distribution pie | Latest `holding_snapshot` grouped by account (+ `account.color`) |
| Holdings list + 30d sparkline | `holding` × `instrument` × latest `price`; sparkline = `price` last 30d; account type via account→account_type |
| Asset modal mode 1 (asset) | `price` series (unit price) |
| Asset modal mode 2 (purchases) | `transaction` buys → invested staircase; `holding.quantity` × `price` → total value |
| Accounts stacked-area | `holding_snapshot` summed per account over time |
| Budget → Transactions list | `budget_transaction_matches` over `transaction` (cash) and `lot` rows (§12.8) |
| Budget → Overview (figures, Sankey, breakdown, trend) | `transaction` × `budget_category` summed per day and category, in the reporting currency (§12.8) |
| Budget → Review | Transactions list filtered on `budget_needs_review` |
| Sync modal | `connection.status` / `last_sync_at` / `last_error` |

### 3.4 Deliberate modeling decisions

- **Net worth / account value are aggregated from `holding_snapshot`**, not stored
  in a separate table. A materialized rollup can be added later if charts get
  slow — premature now.
- **The `account_type` reference table** makes a new type a data insert, never a
  migration.
- **Powens' `real_estate` account type deliberately falls through to the
  `brokerage` fallback** in `map_type_key`, so a real-estate placement displays
  as "Brokerage". This is intentional, not an oversight — do not give it its
  own type without reconsidering the tradeoff.
- **Liabilities are skipped, not typed.** `map_type_key` returns `None` for
  Powens' `loan` and `card` values (the only two liability values Powens
  actually emits) and `map_sync` skips those accounts and their holdings
  entirely. They get their own account types if and when net worth becomes
  assets − liabilities.
- **Escape hatches** (`*_meta` JSONB, `external_id`) let any future provider stash
  specifics and dedup without schema churn. The DB stays gripsou-shaped; adapters
  absorb the weirdness.
- **When a provider gives only aggregate cost basis** (Powens often does),
  `holding.cost_basis` carries it and the mode-2 staircase degrades to a single
  step — no breakage, no missing data path.

---

## 4. Provider abstraction (anti-corruption layer)

Three ports, expressed as Rust traits. Adapters translate provider data into
**canonical DTOs**; the core never imports a provider's native types. Adding a
provider = implement a trait + register it. No core or schema change.

```rust
// Canonical DTOs owned by the core (the ACL boundary)
struct CanonicalAccount { /* name, type, currency, external_id, meta */ }
struct CanonicalHolding { /* instrument ref, quantity, cost_basis, valuation */ }
struct CanonicalTransaction { /* type, ts, qty?, unit_price?, amount, external_id */ }
struct PricePoint { ts: DateTime, unit_price: Decimal, currency: String }

trait AccountProvider {
    fn key(&self) -> &str;                       // "powens"
    async fn connect(&self, ..) -> ConnectInit;  // may return a redirect/webview URL
    async fn complete_connect(&self, ..) -> Credentials;  // external auth round-trip
    async fn sync(&self, ctx) -> SyncResult;     // { accounts, holdings, transactions }
}

trait PriceProvider {
    fn key(&self) -> &str;
    async fn supports(&self, instrument: &Instrument) -> bool;
    async fn fetch_prices(&self, instrument, range) -> Vec<PricePoint>;
}

// core/src/categorize.rs — budget AI categorisation (§12.4)
trait Categorizer {
    fn key(&self) -> &str;                       // "gemini" | "jev"
    fn model(&self) -> &str;
    fn batch_size(&self) -> usize;               // items per call; the run's checkpoint
    async fn categorize(&self, req: &CategorizeRequest)
        -> Result<CategorizeOutput, CategorizeError>;
}
```

- **Dependency direction is compiler-enforced** by splitting `core` and
  `providers` crates: `providers` depends on `core`, never the reverse.
- **Registry:** providers register at startup into a map keyed by `key`;
  `app_settings.enabled_providers` gates which surface in the UI (admin's
  "choose data providers" setting).
- **`connect` / `complete_connect` split** exists for providers needing an
  external auth round-trip (Powens bounces the user to a hosted webview and back
  via callback).

---

## 5. Sync & time-series strategy

Two feeds, cleanly separated:

1. **Account providers** → daily sync → snapshots of balances/positions +
   transactions. Quantity is anchored at each snapshot. Cash-like accounts hold
   their value flat between snapshots (step function).
2. **Price providers** → per-instrument price series → fills intraday, backfills
   history, enables accurate PnL.

**Net worth at instant `t` = Σ over holdings of `quantity(last snapshot)` ×
`price(t)`.** Daily snapshots anchor quantity; price series provide fine detail.

### Sync flow (daily scheduler, or on-demand from the sync button)

1. Pick a `connection` → set `status = syncing` (per-connection lock; prevents
   double runs).
2. `adapter.sync()` → canonical accounts / holdings / transactions.
3. Core upserts accounts & holdings; inserts transactions (dedup on `external_id`).
4. Core stamps today's `holding_snapshot` per holding (idempotent on
   `(holding_id, as_of)`).
5. Core backfills derived history, then runs the budget **pairing pass**
   (§12.3) for the connection's owner — all inside the same DB transaction.
6. For instruments with a `PriceProvider`, fetch intraday / backfill `price` points.
7. Set `status = ok`, `last_sync_at = now` (or `last_error` on failure).
8. After the sync lock is released, request one **AI categorisation run** for
   the user (§12.5). The daily scheduler waits for all of a user's connections
   first, then requests a single run.

**Snapshots are written by the core, not the provider** — so the net-worth series
exists for every provider, even one that only reports current balances. "Sync all"
fans out across connections as parallel tokio tasks, one lock each. The frontend
polls `connection.status` (TanStack Query) for the modal's loading/last-sync state.

### Chart y-axis (resolved open question)

Not anchored at 0. Range = `[min(series) − 10% of span, max(series) + 10% of span]`
across both the net-worth and invested-capital lines, so small moves stay legible.
The %/value toggle reshapes labels, not the axis.

---

## 6. Users & auth (v1, minimal)

- **Roles:** `admin`, `user`. At least one admin, bootstrapped on first run.
- **Invite:** admin creates an invite → `invite_token` (24h). Link lets the new
  person set name/email/password and shows the "whoever owns the server has access
  to all your data" notice before confirming.
- **Reset password:** admin generates a reset token (24h, same table,
  `type = reset`) → link → user sets a new password.
- **Remove user:** deletes the user and all their data (cascade through
  connections → accounts → holdings/snapshots/transactions). Confirmed by typing
  the user's email.
- **Login:** `POST /auth/login` → argon2 verify → opaque server-side session.
  Mints a random token; stores only its SHA-256 hash in a `session` row. Client
  persists the token in `localStorage` (remembered, sliding 30-day expiry) or
  `sessionStorage` (not remembered, 1-day expiry). Every request validates by
  hash; revoking deletes the row. Account page lists and revokes sessions;
  changing password revokes all other sessions. 2FA is future.
- **Authorization:** every data query scoped by `user_id` (via `connection`).
  Admin-only endpoints for user management, CORS origins, and provider enablement.

---

## 7. Cross-cutting concerns

- **Money:** `rust_decimal` ↔ `NUMERIC` end-to-end; never floats. API sends
  decimals as strings; the frontend formats them. Net-worth/PnL math has dedicated
  tests.
- **Formatting & i18n:** per-user `prefs` store independent fields, driven into
  `Intl` with explicit options for free-form combinations (e.g. US date + custom
  number format). UI strings via react-i18next (en/fr).
- **Credentials at rest:** provider credentials/tokens encrypted with AES-GCM
  using a server key from env (`ENCRYPTION_KEY`). Plaintext secrets never hit the DB.
- **Config split:** secrets/infra via env (`DATABASE_URL`, `ENCRYPTION_KEY`,
  Powens app credentials, AI API keys `GEMINI_API_KEY` / `JEV_API_KEY`);
  runtime/admin-tunable values (`cors_origins`, `enabled_providers`,
  `base_currency`, `budget_ai_provider`, `budget_ai_model`, `budget_ai_prices`)
  in `app_settings`; per-user choices (`budgetAiEnabled`, `budgetAiThreshold`)
  in `users.prefs`.

---

## 8. Deployment

Docker Compose, two services:

- **backend** — the single Rust binary; serves the built SPA's static files **and**
  the JSON API. Runs `sqlx migrate` on startup.
- **postgres** — the database.

One `docker compose up` self-hosts the whole app. The in-process tokio scheduler
runs the daily sync; no separate worker/queue service for v1 (single-instance).

---

## 9. Repository layout (monorepo)

```
gripsou/
├─ backend/                Rust workspace
│  ├─ core/                domain model, DB (sqlx), canonical DTOs, net-worth/PnL
│  ├─ providers/           adapters (powens, marketdata, …) — depends on core only
│  ├─ api/                 axum handlers, auth, routing
│  └─ jobs/                scheduler + sync orchestration
├─ frontend/               Vite + React SPA
├─ docker/                 Dockerfile(s), compose
├─ docs/                   specs, notes
├─ REQUIREMENTS.md
└─ ARCHITECTURE.md
```

Splitting `core` / `providers` enforces the anti-corruption dependency direction
at compile time.

---

## 10. Testing strategy

- **Adapter mapping tests** against recorded provider-response fixtures — proves
  Powens JSON → canonical DTOs without a live account.
- **Integration tests** against a throwaway Postgres (sqlx) for upsert/snapshot/
  sync paths.
- **Property tests** for money and PnL math.
- **Frontend** unit/component tests with Vitest. Playwright is a later add.

---

## 11. Future-proofing summary

| Future feature | Already accommodated by |
|---|---|
| Manual accounts/transactions | `account.connection_id` nullable; `ManualAdapter` implements the same trait |
| Multi-currency | Implemented. An FX rate is a `price` row on the per-currency cash `instrument`; `fx_asof` / `unit_value_asof` / `reporting_fx_asof` (migration 0010) convert at read time. A new currency needs no migration — the cash instrument and its Yahoo `{cur}{pivot}=X` pair are created on first sight, including the reader's reporting preference, which nothing else would make eligible. `reporting_fx_degraded` (0026) flags the fallback-to-pivot case. |
| Transactions page | ✓ Delivered as Budget → Transactions (§12) |
| New account types | Insert into the `account_type` reference table |
| ETF sector/country breakdown | `instrument.meta` JSONB |
| Persistent sessions / connected devices | ✓ Delivered via opaque `session` table (v1) |
| 2FA | Future; slots into opaque session auth without redesign |
| Scale (charts slow) | Promote `holding_snapshot` / `price` to TimescaleDB hypertables; add materialized rollups |

---

## 12. Budget

The Budget page answers "where did the money go": every cash transaction gets a
category of the user's own taxonomy, optionally tags, and the Overview sums
them. Categorisation is a pipeline of stages, each allowed to write only where
no stronger stage has: **the user** outranks **pairing** (internal transfers,
found deterministically at sync), which outranks **the AI** (an optional model
call, never trusted without validation). Nothing is provider-specific: the
pipeline reads the canonical `transaction` rows and never an adapter's payload.

Everything is prefixed `budget_` because "category" already meant the
account-type grouping once, and the collision was a bug.

### 12.1 Tables and columns (migrations 0028, 0029, 0030)

**budget_category** — the per-user taxonomy
- `id`, `user_id` → users.id (cascade), `name` (unique per user), `color`,
  `icon`, `hint` (English text the AI reads to tell categories apart)
- `kind` (`expense` | `income` | `internal` | `excluded`): which side of the
  Overview the category counts on. `internal` is money that stays the user's
  (transfers, savings, investments); `excluded` is left out of every total.
- `default_key` — set on seeded rows so the frontend can translate the name;
  cleared on rename, after which the user's own wording shows verbatim.
- `system_key` — only `internal_transfer`, the category pairing writes into;
  the repository refuses to delete it (unique per user).
- `sort_order` (1..n within a kind, renumbered on every reorder), `archived_at`.
- Seeded per user, not as global reference rows, because the user owns and may
  rename or delete every one: `seed_budget_categories()` runs from the
  `users_seed_budget_categories` **after-insert trigger on `users`** (a trigger
  rather than application code: there are several user-creation sites, and
  tests insert users directly). 0028 also seeds every existing user.

**budget_tag** / **budget_transaction_tag** — free-form, per-user labels
(`name` unique per user, optional `color`, listed in creation order) and the
many-to-many link to `transaction`. Several tags in a filter mean *all* of them.

**transaction** budget columns
- `budget_category_id` → budget_category.id (`on delete set null`).
- `category_source` (`user` | `pair` | `ai` | null) — who wrote the category,
  which is what decides who may overwrite it:
  - `user`: set by a person. Nothing automatic ever touches it again. Clearing
    the category nulls the source too, handing the row back to the pipeline.
  - `pair`: written by the pairing pass, always together with
    `transfer_pair_id`.
  - `ai`: a model's guess. `budget_category_id` null with source `ai` is an
    abstention ("no guess"): final, never sent again, shown in Review.
  - null: uncategorised, i.e. the AI's work set.
- `category_confidence` (0–1, AI rows only) and `category_reviewed_at` (a
  person accepted or corrected the guess). A reviewed AI row counts as
  confirmed: pairing no longer overwrites it and it becomes AI evidence.
- `checked_at` — the user's own bookkeeping tick (shown only with the
  `showChecked` pref). It confirms nothing and no stage reads it.
- `transfer_pair_id` → transaction.id (`on delete set null`) — the other half
  of an internal transfer. Both halves point at each other.
- `description_norm` (0029) — generated column,
  `budget_norm_description(description)`, with a b-tree and a trigram index,
  so the AI's evidence lookup and "apply to all with this description" are
  indexed. If the function ever changes, the column must be rebuilt.

**budget_ai_lock** — one row per user while a categorisation run holds them:
`user_id` (PK), `heartbeat_at`. See §12.5.

**budget_ai_run** — the run log, one row per run: `user_id`, `started_at`,
`model` (`provider:model`, e.g. `gemini:gemini-3.5-flash-lite`), `tokens_in`,
`tokens_out`, `usage_complete` (false once any call did not report its token
counts: the totals are then a floor), `outcome` (`running` | `ok` | `partial`
| `error`), `error`. Updated after every paid call so the spend survives a run
that dies half-way.

### 12.2 SQL functions and triggers

All budget readers go through these so the list, its counts, the review queue
and bulk writes can never disagree about which rows exist.

- **`budget_norm_description(text)`** — the identity of "the same
  description": lowercased, dates and digit runs removed, whitespace collapsed.
  Immutable so it can back a generated column. No meaning beyond string
  identity; card masks are the adapter's to strip at ingest.
- **`budget_hidden_pea_leg(account_type, external_id, type)`** — true for a
  provider buy/sell on a PEA: the cash leg of a purchase `lot` already holds.
  Every budget reader leaves it out (buying an ETF is not spending, and the
  list would show the purchase twice). Transfers *into* the PEA are not
  covered: pairing files both halves as internal transfer.
- **`budget_needs_review(source, reviewed_at, confidence, category_kind,
  threshold)`** — the review rule: an unreviewed AI row whose confidence is
  missing or below the reader's threshold, or whose guess is `internal` /
  `excluded` (a guess there hides money from every total, so it is always
  reviewed). Returns null rather than false for non-AI rows so a `where` clause
  can still use the partial index on unreviewed AI rows.
- **`budget_transaction_rows(user, threshold)`** → `setof
  budget_transaction_row` — every row of the Transactions list, unfiltered:
  the user's cash transactions (minus hidden PEA legs) `union all` their lots.
  Lots come through as structured rows (ticker, quantity, unit price, fee,
  signed cash impact) for the frontend to format, and carry no budget. Also
  derives `needs_review`, `is_transfer`, `is_orphan_transfer` (source `pair`
  but the link is gone: the user recategorised the other half) and
  `is_internal_transfer`.
- **`budget_transaction_matches(user, threshold, search, account, from, to,
  bucket, categories, tags, uncategorized, needs_review, include_transfers)`**
  — the Transactions filter, defined once: the list pages it, the header counts
  it, and "select all shown" writes to its cash rows. Days are UTC days.
  Internal transfers are hidden unless `include_transfers` is set.
- **`transaction_partner_deleted` trigger** — before an update that nulls
  `transfer_pair_id` on a `pair` row: if the partner row no longer exists
  (its connection was deleted), the surviving half is uncategorised again
  (category and source nulled), so it is a candidate for the next pairing pass
  instead of counting as money set aside. A pair the user breaks by
  recategorising one half is left alone, because the partner still exists.
- **`users_seed_budget_categories` trigger** — seeds the taxonomy for every new
  user (§12.1).

### 12.3 Pairing pass (stage 1)

`core::budget::pairing::pair_internal_transfers` finds the two halves of a
movement between the user's own accounts and files both under the
`internal_transfer` category with `category_source = 'pair'` and each other's
id in `transfer_pair_id`, so they stop showing as income and expense.

- **When:** at the end of every ingest (`core::ingest`), inside the same DB
  transaction as the upserts and the backfill, under the user's advisory lock
  (taken at the top of the ingest). Scoped to the connection's *owner*, not the
  connection: the two halves routinely live under two different connections.
  A failed sync leaves no half-paired ledger.
- **Candidates:** unpaired rows of `type = 'transfer'` with a non-zero amount
  whose category is empty, a `pair` whose partner went away, or an AI guess
  nobody reviewed. Never a user category or an accepted guess. Other types are
  excluded because matching is by amount and date alone and coincidences
  (a card payment equal to an incoming transfer) are common.
- **Rule:** opposite signs, equal magnitude, same currency, different accounts,
  within 3 days. Deliberately timid, because a false pair silently deletes real
  spending: mutual nearest neighbour only, and a tie pairs nothing unless the
  tied rows are interchangeable. Rounds repeat until one pairs nothing; what is
  left gets one more look for clusters that can be paired off in exactly one
  way (a chain through a middle account). All pairs are written in one
  statement; a write that misses a row is a hard error.
- Idempotent: a paired row is never re-paired, and a converged ledger writes
  nothing on a re-run.

### 12.4 Categoriser port (stage 2)

The third provider port, in `core/src/categorize.rs`, with adapters in
`providers` (`gemini`, `jev`). Same anti-corruption discipline as the other
two: no vendor type crosses into `core`.

- **Item-shaped, not prompt-shaped.** A `CategorizeRequest` holds the user's
  non-archived categories (`CategoryOption`: id, name, kind, hint), up to ten
  recent corrections shared by every item, and the items. Each
  `CategorizeItem` carries the transaction id (`key`, never sent to the model),
  description, signed amount, currency, account type, date, its `candidates`
  (expense/income by the amount's sign, plus internal and excluded; none for a
  zero amount) and its `examples`: up to 20 confirmed rows with the same
  `description_norm`, then up to 5 trigram neighbours. "Confirmed" means set by
  the user or a reviewed AI guess.
- **Output:** `CategorizeOutput { guesses, usage, interrupted }`. A `Guess` of
  `category_id: None` is an explicit "nothing fits". An item with no guess at
  all was not answered and stays in the work set. `interrupted` returns the
  answers received before a failure, so they are written and paid for once.
  `CategorizeError::RateLimited` ends the run as `partial`; `Other` as `error`.
- **Never trusted:** `core::budget::ai::decide` keeps exactly one guess per
  item whose id is among the item's candidates; two guesses, an id it was not
  offered, or "nothing fits" become an abstention. Confidence is clamped to
  0–1.
- **Adapters:** *Gemini* sends 50 items per `generateContent` call with a
  `responseSchema` whose enum is the batch's allowed category ids (default
  model `gemini-3.5-flash-lite`). *Jev* asks one `choice` question per
  transaction, eight in flight at once; the first failure stops the batch and
  returns what was answered (default model `jev-latest`). Both take 50 items
  per `categorize` call, which is also the run's checkpoint size.
- **Registry:** the `CATEGORIZERS` table in `jobs` is the only list of
  providers; each entry owns its env key. Adding one touches no schema.

### 12.5 AI run lifecycle

`core::budget::ai::run_for_user`, started by `jobs::request_categorize`:

1. **Gate.** A run starts only if `app_settings.budget_ai_provider` names a
   provider whose API key is in the environment *and* the user opted in
   (`budgetAiEnabled`). `POST /budget/categorize` answers 409 otherwise.
2. **One run per user.** In-process, a map of live runs per user: a request
   while one is going is not dropped but coalesced into exactly one more run
   after it, so rows a later sync brought in are not left for tomorrow. In the
   DB, `budget_ai_lock` is claimed with an insert that can only take over a row
   whose heartbeat is older than 30 minutes.
3. **Run row.** Any `running` rows of the user are closed as `error` (no live
   task owns them once the lock is held). If the work set is empty, no run row
   is written. Otherwise a `budget_ai_run` row opens as `running`.
4. **Chunks.** The work set is uncategorised cash rows (source null, category
   null, non-zero, not a hidden PEA leg), newest first, re-read before every
   chunk minus the rows this run already sent. After each call the usage is
   recorded first (which also beats the lock's heartbeat), then the decisions
   are written in one guarded statement that never overwrites a row someone
   categorised meanwhile and turns a category deleted meanwhile into an
   abstention.
5. **Finish.** `ok` when the work set is empty; `partial` on a rate limit;
   `error` on any other model or DB failure, with the message. The lock is
   always released.
6. **Retry of unanswered items.** Nothing is marked for an item the model did
   not answer: it keeps source null, so the next run picks it up again. A run
   that dies half-way therefore only leaves rows for the next one.
7. **Crash safety.** The run executes in its own task; a panic closes its run
   row as `error` and releases the lock (`budget::ai::abandon`). At boot the
   scheduler clears every lock and closes every `running` row, since the app is
   single-process and any such row belongs to a dead run.

**Triggers:** after every successful sync of a connection (once the sync lock
is released: categorising never holds a sync); after the daily scheduler has
synced *all* of a user's due connections (one run for the user, so a run
started after the first connection neither misses the others' rows nor pays
for transfer halves their pairing is about to claim); when the user turns the
opt-in on; and on demand from the Overview banner. `GET
/budget/categorize/status` reports configured, running, remaining rows, the
review count and the last finished run.

### 12.6 User writes and the pair-break confirmation

Every category write in `repo::budget::assign` sets `category_source = 'user'`,
clears the confidence and stamps `category_reviewed_at` (clearing the category
nulls all three, handing the row back to the pipeline). The endpoints are
`PATCH /transactions/{id}` (category, tags and ✓ together or not at all),
`POST /transactions/{id}/apply-to-description` (every row with the same
`description_norm`) and `POST /transactions/bulk` (explicit `ids`, or the
list's own `filter` parameters for "select all shown", decoded by the same code
as the list so the write and the view match). Review has
`POST /budget/review/{id}/accept` (keep the guess, stamp it reviewed) and
`.../undo` (put a resolved row back with the guess last shown).

**A user category write dissolves every transfer pair it touches**: both halves
lose `transfer_pair_id`; the untouched half keeps its `pair` source and shows
as an orphaned transfer. Because that is destructive and easy to miss, it is a
two-step protocol:

1. The client sends the write. The server locks the target rows; if any is half
   of a pair and the body has no `confirmBreakPairs`, **nothing is written** and
   the response carries `pendingPairBreaks: n` (rows that would be unlinked,
   counted by the server since a filter write can reach rows the client never
   loaded). This is deliberately distinct from `updated: 0`.
2. The frontend shows `BreakPairModal` with that count; on confirm it re-sends
   the identical body with `confirmBreakPairs: true`.

Tags and ✓ break nothing and are never gated.

### 12.7 Configuration

- **Env (secrets):** `GEMINI_API_KEY`, `JEV_API_KEY` (see `.env.example`). A
  blank key counts as absent. A provider appears in Settings → Server only when
  its key is set. Keys never go in the DB.
- **`app_settings` (admin, Settings → Server):** `budget_ai_provider` (null =
  AI off for the instance), `budget_ai_model` (blank = the adapter's default),
  `budget_ai_prices`. `GET /settings/budget-ai/usage` sums the run log per model
  and prices it with `budget_ai_prices`; a model without a price shows tokens
  only.
- **`users.prefs` (per user, Settings → Budget):** `budgetAiEnabled` (opt-in,
  off by default: the operator configuring a provider does not decide for
  every user), `budgetAiThreshold` (50–95 %, default 70; the API refuses
  anything outside, a stored value outside is clamped on read), `showChecked`.
  Settings → Budget also manages categories (create, rename, recolour, hint,
  reorder, archive, delete) and tags.

### 12.8 Budget page

`/budget`, a top-level page with three modes (the old `/transactions` URL
redirects to `/budget/transactions`). Period and filters live in a shared
`BudgetProvider` context, so moving between modes keeps them.

- **Overview** (`/budget/overview`, the landing mode) — opens on the latest
  month that has transactions. One aggregation (`repo::budget::summary`) reads
  day × category buckets already converted to the reporting currency (a bucket
  with a missing rate is flagged, not guessed); `core::budget::overview` does
  the rest as pure, DB-free functions: figures (income, expenses, net, saved =
  net outflows into `internal` categories; `excluded` never counts), a Sankey
  from income to expenses and savings, a per-category breakdown, and a trend
  over months with small categories collapsed into Other. Uncategorised money
  is its own slice. The AI banner shows run status, rows left and the review
  count. Clicking a slice opens the Transactions list filtered on it.
- **Transactions** (`/budget/transactions`) — the infinite list from
  `budget_transaction_matches` (cash rows and lots), with search, account, date,
  in/out/lots bucket, category, tag, uncategorised, needs-review and
  internal-transfer filters, a matching count, inline category/tag/✓ editing,
  an "apply to the N others with this description?" offer after a category
  change, and a selection bar for bulk writes (selected rows or all shown).
- **Review** (`/budget/review`) — the queue of rows `budget_needs_review`
  flags, all-time and including internal transfers. Accept keeps the guess;
  correcting sets a user category and offers to apply it to the same
  description; resolved lines stay visible with Undo until cleared.
