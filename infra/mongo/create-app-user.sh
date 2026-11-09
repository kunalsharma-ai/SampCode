#!/bin/bash
# Runs once, when MongoDB starts on an empty volume (docker-entrypoint-initdb.d). Creates the user the
# API, worker, migrate job and backups connect as: readWrite on the zapx database only. The root user
# (MONGO_ROOT_USER) is for the replica set and for people, never for the apps.
set -euo pipefail
: "${MONGO_APP_USER:?set MONGO_APP_USER}" "${MONGO_APP_PASSWORD:?set MONGO_APP_PASSWORD}"
mongosh --quiet -u "$MONGO_INITDB_ROOT_USERNAME" -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin admin --eval '
  db.createUser({
    user: process.env.MONGO_APP_USER,
    pwd: process.env.MONGO_APP_PASSWORD,
    roles: [{ role: "readWrite", db: "zapx" }],
  });
'
echo "Created MongoDB user $MONGO_APP_USER (readWrite on zapx)"
