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

Designed _around_ but not _built_ now: manual entry, the Transactions page UI,
2FA, ETF country/sector breakdowns. The model leaves room for each without
rework. Multi-currency conversion, once in this list, has since shipped (§11).

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
  └─ PriceProvider:    market data (intraday + historical backfill)
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
                                   └─1∞─ transaction ─∞1─ instrument?
account ─∞1─ account_type
user ─1∞─ invite_token
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
  `currency_position` (`before` | `after`), `percent_decimals` — all independent
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
  user's `prefs.currency` by `reporting_fx_asof()`.

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

**transaction** — generalist: cash statement lines **and** investment buys/sells.
Buy/sell rows _are_ the lots that build the "capital invested" staircase.
- `id`, `account_id` → account.id, `instrument_id` → instrument.id (nullable for
  pure cash movements)
- `ts`, `type` (`deposit` | `withdrawal` | `buy` | `sell` | `dividend` | `fee`
  | `interest` | `transfer`)
- `quantity` (nullable), `unit_price` (nullable), `amount` (cash impact),
  `fee` (nullable)
- `external_id` (dedup), `provider_meta` (JSONB)

### 3.3 How each UI element maps onto the model

| UI element | Source |
|---|---|
| Net-worth chart (24h…max) + capital invested | `holding_snapshot` anchors qty/cost; × `price(t)` intraday → Σ. Invested = Σ `cost_basis` over time |
| Account distribution pie | Latest `holding_snapshot` grouped by account (+ `account.color`) |
| Holdings list + 30d sparkline | `holding` × `instrument` × latest `price`; sparkline = `price` last 30d; account type via account→account_type |
| Asset modal mode 1 (asset) | `price` series (unit price) |
| Asset modal mode 2 (purchases) | `transaction` buys → invested staircase; `holding.quantity` × `price` → total value |
| Accounts stacked-area | `holding_snapshot` summed per account over time |
| Transactions page (future) | `transaction`, filterable by account/date |
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

Two ports, expressed as Rust traits. Adapters translate provider data into
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
5. For instruments with a `PriceProvider`, fetch intraday / backfill `price` points.
6. Set `status = ok`, `last_sync_at = now` (or `last_error` on failure).

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
  Powens app credentials); runtime/admin-tunable values (`cors_origins`,
  `enabled_providers`) in `app_settings`.

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
| Multi-currency | Implemented. An FX rate is a `price` row on the per-currency cash `instrument`; `fx_asof` / `unit_value_asof` / `reporting_fx_asof` (migration 0010) convert at read time. A new currency needs no migration — the cash instrument and its Yahoo `{cur}{pivot}=X` pair are created on first sight. |
| Transactions page | `transaction` table already generalist and populated |
| New account types | Insert into the `account_type` reference table |
| ETF sector/country breakdown | `instrument.meta` JSONB |
| Persistent sessions / connected devices | ✓ Delivered via opaque `session` table (v1) |
| 2FA | Future; slots into opaque session auth without redesign |
| Scale (charts slow) | Promote `holding_snapshot` / `price` to TimescaleDB hypertables; add materialized rollups |
