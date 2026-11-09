#!/usr/bin/env bash
# Restore a backup made by backup.sh into the (empty) database at DATABASE_URL, then recreate the
# indexes the schema declares (packages/db/src/indexes.ts).
# Usage: DATABASE_URL=mongodb://... infra/scripts/restore.sh backups/zapx-....archive.gz
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
FILE="${1:?backup file}"
mongorestore --uri="$DATABASE_URL" --gzip --archive="$FILE" --stopOnError
node "$(dirname "$0")/../../packages/db/dist/indexes.js"
echo "Restored $FILE"
