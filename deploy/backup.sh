#!/bin/sh
# Nightly dump with 14 days of retention.
#
# This keeps backups on the same machine as the database, which protects you
# from mistakes but NOT from losing the machine. Copy them somewhere else —
# see the note in README.md.
set -eu

KEEP_DAYS=14
STAMP=$(date +%Y%m%d-%H%M)
OUT="/backups/nayla-${STAMP}.dump"

docker compose exec -T db \
  pg_dump -U postgres -d nayla --format=custom --file="$OUT"

docker compose exec -T db \
  find /backups -name 'nayla-*.dump' -mtime "+${KEEP_DAYS}" -delete

echo "backed up to $OUT"
