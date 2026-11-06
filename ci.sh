#!/usr/bin/env bash
# The CI checks. GitHub runs `./ci.sh backend` and `./ci.sh frontend` as two
# jobs; with no argument both run. Every step runs even after a failure, and
# the exit status says whether any failed.
set -uo pipefail
cd "$(dirname "$0")"

export SQLX_OFFLINE=true

fail=0
step() {
  echo "::: $1"
  shift
  ( "$@" ) || { echo "FAIL: $*"; fail=1; }
}

# The tests run on a throwaway Postgres, never the dev one. Every
# #[sqlx::test] copies template1 into a new database and migrates it, so
# template1 is migrated first (then each test finds everything applied) and
# the data lives in RAM without fsync (nothing here is worth keeping). Both
# would be wrong on the dev server; here template1 is rebuilt every run, so it
# never keeps the old version of a migration you are editing. The image is the
# one docker-compose.yml runs.
test_db() {
  image=$(sed -n 's/^ *image: *\(postgres:.*\)$/\1/p' docker/docker-compose.yml)
  db=gripsou-ci-$$
  docker run -d --rm --name "$db" --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER=gripsou -e POSTGRES_PASSWORD=gripsou -e POSTGRES_DB=gripsou \
    "$image" -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
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

backend() {
  step "fmt"    bash -c 'cd backend && cargo fmt --all --check'
  step "clippy" bash -c 'cd backend && cargo clippy --all-targets -- -D warnings'
  # The frontend's copy of the API types and routes is generated: it must match the code.
  step "wire types" bash -c 'cd backend && cargo run -q -p gripsou-api --example wire-types \
    && git diff --exit-code -- ../frontend/src/api/wire.ts ../frontend/src/api/routes.ts'
  echo "::: test-db"
  if test_db; then
    step "test" bash -c 'cd backend && cargo test'
  else
    echo "FAIL: test database"; fail=1
  fi
}

# The image builds the SPA with its own bun, which must be the one
# package.json pins.
same_bun() {
  version=$(sed -n 's/^ *"packageManager": "bun@\(.*\)",$/\1/p' frontend/package.json)
  grep -q "^FROM oven/bun:$version " docker/Dockerfile \
    || { echo "docker/Dockerfile must build with bun $version, as frontend/package.json pins"; return 1; }
}

frontend() {
  step "bun version" same_bun
  step "install" bash -c 'cd frontend && bun install --frozen-lockfile'
  step "lint"    bash -c 'cd frontend && bun run lint'
  step "ftest"   bash -c 'cd frontend && bun run test'
  step "build"   bash -c 'cd frontend && bun run build'
}

jobs=("$@")
[ ${#jobs[@]} -eq 0 ] && jobs=(backend frontend)
for job in "${jobs[@]}"; do
  case $job in
    backend | frontend) $job ;;
    *) echo "unknown job: $job (backend or frontend)"; exit 2 ;;
  esac
done

echo
[ $fail -eq 0 ] && echo "CI WOULD PASS" || echo "CI WOULD FAIL"
exit $fail
