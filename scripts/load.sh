#!/usr/bin/env bash
# Loads every db/*.sql in order into the running container.
set -euo pipefail
cd "$(dirname "$0")/.."

for f in db/*.sql; do
  echo "== $f"
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U falaq_owner -d falaq < "$f"
done

echo "== counts"
docker compose exec -T db psql -U falaq_owner -d falaq -c \
  "select 'users' t, count(*) from users
   union all select 'stores', count(*) from stores
   union all select 'books', count(*) from books;"
