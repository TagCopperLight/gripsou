#!/usr/bin/env bash
# Prints the SQL that sets every applied migration's stored checksum to the
# file's current one, for a database that ran a migration since edited.
# sqlx's checksum is the SHA-384 of the file. Only for edits that change no
# schema (comments): the database is not migrated again.
#
#   scripts/rehash-migrations.sh | docker exec -i gripsou-postgres-1 psql -U gripsou -d gripsou
set -eu

cd "$(dirname "$0")/../backend/migrations"
echo "begin;"
for f in [0-9]*.sql; do
  version=$((10#${f%%_*}))
  sum=$(sha384sum "$f" | cut -d' ' -f1)
  echo "update _sqlx_migrations set checksum = decode('$sum', 'hex') where version = $version and checksum <> decode('$sum', 'hex');"
done
echo "commit;"
