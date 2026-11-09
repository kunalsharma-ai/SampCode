#!/usr/bin/env bash
# Restore a backup made by backup.sh into the (empty) database at DATABASE_URL, then recreate the
# indexes the schema declares (packages/db/src/indexes.ts).
#
#   DATABASE_URL=mongodb://... infra/scripts/restore.sh backups/sampcode-....archive.gz
#
# On a Docker Compose deployment, run it in the backup container and let the migrate job rebuild
# the indexes (docs/operations/database.md):
#   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm backup "/scripts/restore.sh /backups/<file>"
#   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
FILE="${1:?backup file}"
mongorestore --uri="$DATABASE_URL" --gzip --archive="$FILE" --stopOnError
INDEXES="$(dirname "$0")/../../packages/db/dist/indexes.js"
if command -v node >/dev/null 2>&1 && [ -f "$INDEXES" ]; then
  node "$INDEXES"
else
  echo "Indexes not rebuilt here: run the migrate job next."
fi
echo "Restored $FILE"
