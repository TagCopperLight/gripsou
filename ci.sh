#!/usr/bin/env bash
# The CI checks. `./ci.sh` runs them all; `./ci.sh <job>...` runs some:
# `backend` is `backend-lint` and `backend-test`, `frontend` is `frontend-lint`
# and `frontend-test`. GitHub runs them as parallel jobs. Every
# step runs even after a failure, and the exit status says whether any failed.
set -uo pipefail
cd "$(dirname "$0")"

export SQLX_OFFLINE=true

fail=0
step() {
  echo "::: $1"
  local name=$1 start=$SECONDS
  shift
  ( "$@" ) || { echo "FAIL: $*"; fail=1; }
  echo "::: $name took $((SECONDS - start))s"
}

# The tests run on a throwaway Postgres, never the dev one. Every
# #[sqlx::test] copies template1 into a new database and migrates it, so
# template1 is migrated first (then each test finds everything applied) and
# the data lives in RAM without fsync (nothing here is worth keeping). Both
# would be wrong on the dev server; here template1 is rebuilt every run, so it
# never keeps the old version of a migration you are editing. The image is the
# one docker-compose.yml runs. Trust auth: an unoptimised build's SCRAM
# handshake on every test connection doubles the test time.
db=gripsou-ci-$$
start_test_db() {
  image=$(sed -n 's/^ *image: *\(postgres:.*\)$/\1/p' docker/docker-compose.yml)
  docker run -d --rm --name "$db" --tmpfs /var/lib/postgresql/data \
    -e POSTGRES_USER=gripsou -e POSTGRES_PASSWORD=gripsou -e POSTGRES_DB=gripsou \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    "$image" -c fsync=off -c synchronous_commit=off -c full_page_writes=off \
    -c max_connections=200 >/dev/null
}

test_db() {
  wait "$db_started" || return 1
  # Over TCP: the image's first, init-only server listens on the socket alone.
  for _ in $(seq 60); do
    docker exec "$db" pg_isready -h 127.0.0.1 -U gripsou -d gripsou -q && break
    sleep 0.5
  done
  ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$db")
  export DATABASE_URL=postgres://gripsou:gripsou@$ip:5432/gripsou
  DATABASE_URL=${DATABASE_URL%/*}/template1 "$examples/migrate"
}

backend-lint() {
  step "fmt"    bash -c 'cd backend && cargo fmt --all --check'
  step "clippy" bash -c 'cd backend && cargo clippy --all-targets -- -D warnings'
  # Without the tests, so the test-util features stay off: production code
  # calling a test-only helper fails here.
  step "clippy (no tests)" bash -c 'cd backend && cargo clippy --workspace -- -D warnings'
}

backend-test() { backend_test --workspace; }
# GitHub runs backend-test as these two halves, each on a runner of its own.
backend-test-api() { backend_test -p gripsou-api; }
backend-test-rest() { backend_test --workspace --exclude gripsou-api; }

# $@: the packages to test, as cargo selects them.
backend_test() {
  start_test_db &
  db_started=$!
  trap 'docker stop "$db" >/dev/null 2>&1' EXIT
  # Also builds the examples with the tests' features: `cargo run --example`
  # would build them again with others.
  step "build" bash -c 'cd backend && cargo test "$@" --no-run \
    && cargo build -q "$@" -p gripsou-core --example migrate' _ "$@"
  examples=backend/${CARGO_TARGET_DIR:-target}/debug/examples
  if [[ " $* " != *" --exclude gripsou-api "* ]]; then
    # The frontend's copy of the API types and routes is generated: it must match the code.
    step "wire types" bash -c "$examples/wire-types \
      && git diff --exit-code -- frontend/src/api/wire.ts frontend/src/api/routes.ts"
  fi
  echo "::: test-db"
  start=$SECONDS
  if test_db; then
    echo "::: test-db took $((SECONDS - start))s"
    step "test" bash -c 'cd backend && cargo test "$@"' _ "$@"
  else
    echo "FAIL: test database"; fail=1
  fi
  docker stop "$db" >/dev/null
}

backend() {
  backend-lint
  backend-test
}

# The image builds the SPA with its own bun, which must be the one
# package.json pins.
same_bun() {
  version=$(sed -n 's/^ *"packageManager": "bun@\(.*\)",$/\1/p' frontend/package.json)
  grep -q "^FROM oven/bun:$version " docker/Dockerfile \
    || { echo "docker/Dockerfile must build with bun $version, as frontend/package.json pins"; return 1; }
}

frontend-lint() {
  step "bun version" same_bun
  step "install" bash -c 'cd frontend && bun install --frozen-lockfile'
  step "lint"    bash -c 'cd frontend && bun run lint'
  step "build"   bash -c 'cd frontend; bun run typecheck & p=$!; bun run bundle; r=$?; wait $p && exit $r'
}

frontend-test() {
  step "install" bash -c 'cd frontend && bun install --frozen-lockfile'
  step "ftest"   bash -c 'cd frontend && bun run test'
}

frontend() {
  frontend-lint
  frontend-test
}

jobs=("$@")
[ ${#jobs[@]} -eq 0 ] && jobs=(backend frontend)
for job in "${jobs[@]}"; do
  case $job in
    backend | backend-lint | backend-test | backend-test-api | backend-test-rest \
      | frontend | frontend-lint | frontend-test) $job ;;
    *) echo "unknown job: $job"; exit 2 ;;
  esac
done

echo
[ $fail -eq 0 ] && echo "CI WOULD PASS" || echo "CI WOULD FAIL"
exit $fail
