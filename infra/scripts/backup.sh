#!/usr/bin/env bash
# Logical backup of the SampCode database (mongodump archive, gzip). Keeps the newest $KEEP files.
# Usage: DATABASE_URL=mongodb://... infra/scripts/backup.sh [backup-dir]
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/sampcode-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
# The archive is a consistent copy of each collection, not of the database at one instant.
mongodump --uri="$DATABASE_URL" --gzip --archive="$FILE"
echo "Backup written: $FILE"
ls -1t "$DIR"/sampcode-*.archive.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
