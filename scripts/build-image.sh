#!/usr/bin/env sh
# Builds the backend image with the version shown in the UI. Only the host sees
# the whole working tree, so only it can tell whether the build is dirty.
# Extra arguments go to `docker compose build`.
set -eu
cd "$(dirname "$0")/.."
VERSION=$(git describe --tags --always --dirty 2>/dev/null || true)
export VERSION
exec docker compose -f docker/docker-compose.yml build "$@" backend
