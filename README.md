# gripsou

Self-hosted personal finance dashboard. Connect bank/broker/crypto providers,
sync transactions and holdings, and see net worth and its distribution over time.

## Inspirations

This project is the result of multiple iterations. I've built this "same" personal finance project before, learned from those attempts, and started from scratch again to build it right.

The initial inspiration came from [Finary](https://finary.com/). Later, I discovered [Zoeille/picsou-finance](https://github.com/Zoeille/picsou-finance), which gave me a fresh wave of inspiration (and heavily influenced the project's name, `gripsou`).

The current interface and workflow are a mix of my own ideas, concepts from Picsou, and Finary.

## Layout

```
backend/    Rust workspace — core (domain + DTOs + provider ports),
            providers (adapters), jobs (scheduler), api (axum bin)
backend/migrations/  sqlx migrations (applied on startup)
frontend/   Vite + React + TypeScript SPA (bun)
docker/     Dockerfile + docker-compose.yml
```

## Develop

Prerequisites: Rust (stable), [bun](https://bun.sh), Docker.

```sh
# 1. Start Postgres
docker compose -f docker/docker-compose.yml up -d postgres

# 2. Backend (serves API on :8080, applies migrations on startup)
cp .env.example .env          # then edit secrets
cd backend
cargo run

# 3. Frontend (dev server on :5173, proxies /api to :8080)
cd frontend
bun install
bun run dev
```

Frontend checks: `bun run build`, `bun run test`, `bun run lint`.
Backend checks: `cargo build`, `cargo test`, `cargo clippy`, `cargo fmt`.

## Run the whole stack

```sh
docker compose -f docker/docker-compose.yml up --build
```

One command self-hosts the app: the backend binary serves both the built SPA and
the JSON API, with Postgres alongside.

## Powens webhooks (optional)

For real-time sync of Powens connections (instead of polling):

1. Expose `https://<host>/api/webhooks/powens` publicly.
2. In the Powens console, register a webhook for `CONNECTION_SYNCED` pointing to that URL.
3. Register an HMAC auth provider on the **Powens** API (not gripsou), using your Powens configuration token:
   ```sh
   POST https://<your-domain>.biapi.pro/webhooks/auth \
     -H "Authorization: Bearer <powens-configuration-token>" \
     -H "Content-Type: application/json" \
     -d '{ "type": "hmac_signature", "name": "gripsou" }'
   ```
   Save the returned `config.secret_key` (shown only once).
4. In the Powens console, associate the auth provider with your webhook.
5. Set `POWENS_WEBHOOK_SECRET=<secret_key>` in the root `.env` and restart the backend.

When `POWENS_WEBHOOK_SECRET` is unset, sync falls back to direct full-fetch and the daily poll schedule.

## Profiling

`backend/core/examples/perf.rs` times the operations that dominate a sync and a
dashboard load: the history rebuild, both chart series, the distribution pie and
the holdings list. It creates a throwaway database, seeds a synthetic portfolio
at a chosen scale, runs `ANALYZE`, and reports min/median/max over several runs.

```sh
cd backend
cargo run -p gripsou-core --example perf -- --holdings 13 --days 1300 --runs 5
cargo run -p gripsou-core --example perf -- ... --save baseline.json    # record
cargo run -p gripsou-core --example perf -- ... --compare baseline.json # diff
```

## Changelog

<details>
<summary><strong>v1.4.1</strong> — performance</summary>

- Performance optimizations
- 30D chart fix
- Yahoo price gap fix (and a tool to repair existing databases)
- Better chart tooltips, fixed percentage charts
</details>

<details>
<summary><strong>v1.4.0</strong> — transactions</summary>

- Transaction page
- Version shown in the app
- Changelog in the README
- Realigned holdings table columns
</details>

<details>
<summary><strong>v1.3.0</strong> — currencies & mobile</summary>

- Currency conversion
- Phone-responsive layout
</details>

<details>
<summary><strong>v1.2.1</strong></summary>

- Alert when an institution logo is missing
- Charts turn red on negative values
</details>

<details>
<summary><strong>v1.2.0</strong> — UI overhaul</summary>

- New connections page and sync page
- Providers and connection sources split in the UI
- Category vs. type confusion resolved
- Smaller buttons and fields
- Bank sources, institution icons, user icons
- ETF category and origin stats
- i18n translations reorganized
</details>

<details>
<summary><strong>v1.1.1</strong></summary>

- Webhook fixes
</details>

<details>
<summary><strong>v1.1.0</strong> — webhooks & user management</summary>

- Powens webhook integration, localhost redirects
- Failed connections stay open
- Users page, invite and reset pages
- EUR symbol in holdings
</details>

<details>
<summary><strong>v1.0.0</strong> — first release</summary>

- Powens and Yahoo integrations, sync button
- Capital invested fix, asset logos
- Server settings page, CI/CD
</details>
