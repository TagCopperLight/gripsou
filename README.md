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
