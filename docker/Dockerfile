# syntax=docker/dockerfile:1

# --- Stage 1: build the SPA ---
FROM oven/bun:1 AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock ./
RUN bun install --frozen-lockfile
COPY frontend/ ./
COPY shared/ ../shared/
RUN bun run build

# --- Stage 2: build the Rust binary ---
FROM rust:1-bookworm AS backend
# Empty by default: build.rs then reads .git itself. Set it only when building
# without git history (a tarball, a shallow CI checkout).
ARG VERSION=
ENV GRIPSOU_VERSION=$VERSION
WORKDIR /app/backend
COPY backend/ ./
COPY shared/ ../shared/
COPY .git ../.git
RUN cargo build --release --bin gripsou

# --- Stage 3: runtime ---
FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /app/backend/target/release/gripsou /usr/local/bin/gripsou
COPY --from=frontend /app/frontend/dist /app/static
ENV STATIC_DIR=/app/static
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["gripsou"]
