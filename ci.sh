#!/usr/bin/env bash
set -uo pipefail

[ -f .env ] && set -a && . ./.env && set +a

export POWENS_CLIENT_ID=test-client
export POWENS_CLIENT_SECRET=test-secret
export POWENS_DOMAIN=test.biapi.pro
export POWENS_REDIRECT_URI=https://gripsou.test/connections/callback
export SQLX_OFFLINE=true

fail=0
step() {
  echo "::: $1"
  shift
  ( "$@" ) || { echo "FAIL: $*"; fail=1; }
}

# backend job
step "fmt"    bash -c 'cd backend && cargo fmt --all --check'
step "clippy" bash -c 'cd backend && cargo clippy --all-targets -- -D warnings'

# The tests run on a throwaway Postgres, never the dev one. Every
# #[sqlx::test] copies template1 into a new database and migrates it, so
# template1 is migrated first (then each test finds everything applied) and
# the data lives in RAM without fsync (nothing here is worth keeping). Both
# would be wrong on the dev server; here template1 is rebuilt every run, so it
# never keeps the old version of a migration you are editing.
test_db() {
  db=gripsou-ci-$$
  docker run -d --rm --name "$db" --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER=gripsou -e POSTGRES_PASSWORD=gripsou -e POSTGRES_DB=gripsou \
    postgres:17-alpine -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
    -c max_connections=200 >/dev/null || return 1
  trap 'docker stop "$db" >/dev/null' EXIT
  # Over TCP: the image's first, init-only server listens on the socket alone.
  for _ in $(seq 60); do
    docker exec "$db" pg_isready -h 127.0.0.1 -U gripsou -d gripsou -q && break
    sleep 0.5
  done
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$db")
  export DATABASE_URL=postgres://gripsou:gripsou@$ip:5432/gripsou
  (cd backend && DATABASE_URL=${DATABASE_URL%/*}/template1 cargo run -q --example migrate)
}
echo "::: test-db"
if test_db; then
  step "test" bash -c 'cd backend && cargo test'
else
  echo "FAIL: test database"; fail=1
fi

# frontend job
step "install" bash -c 'cd frontend && bun install --frozen-lockfile'
step "lint"    bash -c 'cd frontend && bun run lint'
step "ftest"   bash -c 'cd frontend && bun run test'
step "build"   bash -c 'cd frontend && bun run build'

echo
[ $fail -eq 0 ] && echo "CI WOULD PASS" || echo "CI WOULD FAIL"
exit $fail
