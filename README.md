# gripsou

Self-hosted personal finance dashboard. Connect bank/broker/crypto providers,
sync transactions and holdings, and see net worth and its distribution over time.

See [REQUIREMENTS.md](REQUIREMENTS.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

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
DATABASE_URL=postgres://gripsou:gripsou@localhost:5432/gripsou cargo run --bin gripsou

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
