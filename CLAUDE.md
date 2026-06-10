# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

gripsou is a self-hosted personal finance dashboard: connect bank/broker/crypto providers, sync transactions and holdings, and view net worth and its distribution over time.

**`ARCHITECTURE.md` is the source-of-truth design** and is far more detailed than this file. Read it before making non-trivial changes; `REQUIREMENTS.md` covers the product/UI spec. The codebase is currently an early scaffold — most modules are stubs that the architecture doc describes filling in.

## Commands

Backend (`cd backend`, a Cargo workspace):
- `cargo build` / `cargo run --bin gripsou` — the single binary serves both the SPA and the JSON API, and runs `sqlx migrate` on startup. Needs `DATABASE_URL` (e.g. `postgres://gripsou:gripsou@localhost:5432/gripsou`).
- `cargo test` — run all tests; `cargo test -p gripsou-core <name>` runs a single test in one crate.
- `cargo clippy` and `cargo fmt` — lint and format.

Frontend (`cd frontend`, uses **bun**):
- `bun install`, `bun run dev` (Vite dev server on :5173, proxies `/api` → :8080).
- `bun run build` (`tsc -b && vite build`), `bun run lint` (eslint), `bun run test` (vitest).
- Single test: `bun run test <file-or-pattern>` (e.g. `bun run test smoke`).

Local stack: `docker compose -f docker/docker-compose.yml up -d postgres` for just the DB, or `... up --build` for the whole app. **Always pass `-f docker/docker-compose.yml`** and rely on the pinned `name: gripsou` — the host has a separate `docker` compose project.

## Architecture

**The database is shaped around gripsou's domain; providers map _into_ it.** Adding a provider must never require a schema migration. This principle drives everything below.

**Backend crate split enforces an anti-corruption layer at compile time:**
- `core` — canonical DTOs (`dto.rs`) and provider ports (`provider.rs`: `AccountProvider`, `PriceProvider` traits), plus DB wiring. The domain boundary.
- `providers` — adapters (`powens`, `marketdata`) that translate native payloads into canonical DTOs. **Depends on `core` only, never the reverse** — that direction is what keeps the schema gripsou-shaped. Never import a provider's native types into `core`.
- `jobs` — the in-process tokio scheduler / sync orchestration (daily sync fans out per-connection tasks, one lock each).
- `api` — the axum binary; handlers, auth, routing, static-file serving.

**Unified holding model:** cash and securities are the same thing — everything owned is a `holding` of an `instrument`. A checking account is a holding of the `EUR` cash-instrument (quantity = balance, price = 1). This yields one snapshot table and one valuation path. `instrument` and `price` rows are **global/shared across users**; everything else is user-scoped via `connection.user_id`.

**Snapshots are written by the core, not providers.** After each sync the core stamps `holding_snapshot` per holding (idempotent on `(holding_id, as_of)`), so a net-worth time series exists even for a provider that only reports current balances. Net worth at instant `t` = Σ `quantity(last snapshot)` × `price(t)`.

## Conventions that bite if missed

- **Money is `rust_decimal::Decimal` ↔ Postgres `NUMERIC`, never floats.** The API sends decimals as **strings**; the frontend formats them.
- **New account types / categories are data inserts** into the `account_type` / `category` reference tables (see `migrations/0002_seed_reference.sql`), **not migrations**.
- **Escape hatches:** `*_meta` JSONB columns and `external_id` (for idempotent provider upserts/dedup) let adapters absorb provider-specific weirdness without schema churn.
- **sqlx is compile-time-checked.** Once `query!`/`query_as!` macros are added, `cargo build` requires a reachable `DATABASE_URL` or committed `.sqlx/` offline data (`cargo sqlx prepare`). The current scaffold has no such queries yet, so it builds without a DB.
- **Config split:** secrets/infra via env (`DATABASE_URL`, `ENCRYPTION_KEY`, `POWENS_*` — see `.env.example`); runtime/admin-tunable values (`cors_origins`, `enabled_providers`) live in the `app_settings` DB row, not env.
- **Credentials at rest** are encrypted with AES-GCM using `ENCRYPTION_KEY`; plaintext secrets never hit the DB.
- Frontend stack: React 19 + TanStack Router (code-based route tree in `router.tsx`) + TanStack Query, ECharts for charts, react-i18next (en/fr in `src/i18n/`). Per-user formatting prefs drive `Intl` with explicit options.

## Testing strategy

Adapter mapping tests against recorded provider-response fixtures (proves provider JSON → canonical DTOs without a live account); integration tests against a throwaway Postgres for upsert/snapshot/sync paths; property tests for money/PnL math; Vitest for frontend.
