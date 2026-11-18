# Database operations

MongoDB 7 or later, as a replica set, through Prisma 6. Decision: [ADR 0040](../adr/0040-mongodb.md)
(and [ADR 0002](../adr/0002-prisma-and-repository-boundaries.md) for the Prisma boundaries).

## Collections and indexes

- Change the schema in `packages/db/prisma/schema.prisma`, then `pnpm --filter @zapx/db build`.
- Apply: `pnpm db:migrate` locally and in CI; in production the `migrate` service of
  `docker-compose.prod.yml` runs on every `up`, before the API starts. It creates every collection and index the schema declares
  (`packages/db/src/indexes.ts`) and does nothing when they exist.
- There are no SQL migrations. A new optional field needs nothing; a renamed or removed field
  ships in two releases (stop using, then clean up the documents with a one-off script).
- An index whose options change (for example a new `@unique`) must be dropped by hand first:
  `db.<Collection>.dropIndex('<name>')`, then `pnpm db:migrate`.

## Replica set

Prisma needs a replica set for transactions. `docker compose up -d mongo` starts a one-member set
(`rs0`); connect from your machine with `mongodb://localhost:27017/zapx?directConnection=true`.

In production (`docker-compose.prod.yml`) the set is also one member, `mongo:27017`, with a key file
(the `mongo-keyfile` service writes it once) and two users made on the first start: the root user
(`MONGO_ROOT_USER`) and the app user (`MONGO_APP_USER`, `readWrite` on `zapx`). MongoDB is not
published on the host. A shell on it:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec mongo \
  mongosh -u root -p --authenticationDatabase admin zapx
```

To change a password later, use `db.changeUserPassword` in that shell, then the new value in
`.env.production` and `up -d` (the values there are used only on an empty volume).

## Connection pooling

Each API process has one pool. Size it in `DATABASE_URL`: `&maxPoolSize=10`. Instances ×
`maxPoolSize` must stay well below the server's connection limit.

## Backups and recovery

On a Docker Compose deployment the `backup` service runs `infra/scripts/backup.sh` every
`BACKUP_INTERVAL_HOURS` (24): a gzip `mongodump` archive of the `zapx` database in `BACKUP_DIR`
(`./backups` next to the compose file), keeping the newest `BACKUP_KEEP` (14).

| When                  | What                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily                 | the `backup` service; then **copy `./backups` off the server** (rsync to another machine, or `aws s3 sync` / `rclone` to a bucket)                                                    |
| Before risky releases | `docker compose -f docker-compose.prod.yml --env-file .env.production exec backup bash -c '/scripts/backup.sh /backups'`                                                              |
| Uploaded files        | the `files` volume: `docker run --rm -v sampcode_files:/f -v "$PWD/backups":/b alpine tar czf /b/files-$(date +%F).tgz -C /f .` (not needed with Settings → Integrations → Amazon S3) |
| Whole server          | a disk snapshot from the hosting provider, if it offers one                                                                                                                           |

Restore into the running stack (it replaces the `zapx` collections that are in the archive):

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC stop api worker
$DC exec backup bash -c 'mongorestore --uri="$DATABASE_URL" --gzip --archive=/backups/<file> --drop --stopOnError'
$DC run --rm migrate      # recreates any index the archive did not carry
$DC up -d
```

Outside Docker, `infra/scripts/backup.sh` and `infra/scripts/restore.sh` do the same with
MongoDB Database Tools (`mongodump`, `mongorestore`) installed.

Targets to agree with customers: RPO 24 hours with the daily backup (run the service more often, with a smaller `BACKUP_INTERVAL_HOURS`, for less), RTO ≤ 1 hour. **Test a restore every
quarter** into a scratch database and run `pnpm test` against it; a backup that has never been
restored is not a backup.

## Moving an existing PostgreSQL installation to MongoDB

A one-off copy, done once per environment during a short maintenance window:

1. Take a PostgreSQL backup with the **old** release's `infra/scripts/backup.sh` (pg_dump).
2. Stop the API and worker (`docker compose -f docker-compose.prod.yml --env-file .env.production stop api worker`).
3. Prepare MongoDB: `DATABASE_URL=mongodb://… pnpm db:migrate`.
4. Copy, with the new release built (`pnpm build`):

   ```bash
   POSTGRES_URL='postgresql://user:password@old-host:5432/zapx' \
   DATABASE_URL='mongodb://…' \
   node packages/db/dist/copy-from-postgres.js
   ```

   It copies every table through Prisma (ids, dates, enums, JSON, arrays kept), refuses to write into
   non-empty collections, prints one line per model and exits non-zero if any row count differs.
   `--only Model,Model` copies some models; `--allow-non-empty` adds to existing collections.

5. Start the new release against MongoDB, sign in, open a few surveys and their data, then switch traffic.
   Keep the PostgreSQL database read-only for a few weeks before deleting it.

## Soft delete

Projects, surveys and vendors have `deletedAt`. Queries filter `deletedAt: null`. Restoring is a
database operation for now (`db.Survey.updateOne({ _id: '<id>' }, { $set: { deletedAt: null } })`),
recorded in the audit trail by hand.

## Tenant isolation

Every tenant-owned document has `tenantId`, and every studio query filters on it. Reads of
respondent data from the studio also go through `prisma.forTenant(tenantId)`, which adds
`tenantId` to every filter on the respondent-data models and refuses writes for another tenant
(ADR 0040; on PostgreSQL this was row-level security, ADR 0012). `GET /api/audit/security` (admins)
answers `enforced`.

In production the API connects as a database user with `readWrite` on the `zapx` database only
(`MONGO_APP_USER`, created by `infra/mongo/create-app-user.sh` on the first start), and MongoDB is
reachable only inside the compose network.
