#!/usr/bin/env bash
set -uo pipefail

[ -f .env ] && set -a && . ./.env && set +a

export DATABASE_URL="${DATABASE_URL:-postgres://gripsou:gripsou@localhost:5432/gripsou}"
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
step "test"   bash -c 'cd backend && cargo test'

# frontend job
step "install" bash -c 'cd frontend && bun install --frozen-lockfile'
step "lint"    bash -c 'cd frontend && bun run lint'
step "ftest"   bash -c 'cd frontend && bun run test'
step "build"   bash -c 'cd frontend && bun run build'

echo
[ $fail -eq 0 ] && echo "CI WOULD PASS" || echo "CI WOULD FAIL"
exit $fail
