#!/usr/bin/env bash
# Logical backup of the SampCode database (mongodump archive, gzip). Keeps the newest $KEEP files.
# Usage: DATABASE_URL=mongodb://... infra/scripts/backup.sh [backup-dir]
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/zapx-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
# For a point-in-time copy of a busy database use the managed backups (snapshots), not this.
mongodump --uri="$DATABASE_URL" --gzip --archive="$FILE"
echo "Backup written: $FILE"
ls -1t "$DIR"/zapx-*.archive.gz | tail -n +"$((KEEP + 1))" | xargs -r rm --
