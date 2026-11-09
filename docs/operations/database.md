# Database operations

MongoDB 7 or later, as a replica set, through Prisma 6. Decision: [ADR 0040](../adr/0040-mongodb.md)
(and [ADR 0002](../adr/0002-prisma-and-repository-boundaries.md) for the Prisma boundaries).

## Collections and indexes

- Change the schema in `packages/db/prisma/schema.prisma`, then `pnpm --filter @zapx/db build`.
- Apply: `pnpm db:migrate` locally and in CI; the `migrate` image (`docker compose` or an ECS
  one-off task) before each release. It creates every collection and index the schema declares
  (`packages/db/src/indexes.ts`) and does nothing when they exist.
- There are no SQL migrations. A new optional field needs nothing; a renamed or removed field
  ships in two releases (stop using, then clean up the documents with a one-off script).
- An index whose options change (for example a new `@unique`) must be dropped by hand first:
  `db.<Collection>.dropIndex('<name>')`, then `pnpm db:migrate`.

## Replica set

Prisma needs a replica set for transactions. `docker compose up -d mongo` starts a one-member set
(`rs0`); connect from your machine with `mongodb://localhost:27017/zapx?directConnection=true`.

## Connection pooling

Each API process has one pool. Size it in `DATABASE_URL`: `&maxPoolSize=10`. Instances ×
`maxPoolSize` must stay well below the server's connection limit.

## Backups and recovery

|                       | Local / single server                                    | AWS (MongoDB Atlas, `infra/terraform/database.tf`)                             |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Continuous            | –                                                        | Atlas point-in-time restore (last 7 days)                                      |
| Daily                 | `infra/scripts/backup.sh` (mongodump archive, keeps 14)  | Atlas daily snapshots, 14 days (`db_backup_retention_days`); files: AWS Backup |
| Before risky releases | `infra/scripts/backup.sh`                                | on-demand Atlas snapshot                                                       |
| Restore               | `infra/scripts/restore.sh <file>` into an empty database | restore into a **new** cluster, verify, switch `DB_HOST`                       |

The scripts need MongoDB Database Tools (`mongodump`, `mongorestore`).

Targets to agree with customers: RPO ≤ 5 minutes (PITR), RTO ≤ 1 hour. **Test a restore every
quarter** into a scratch database and run `pnpm test` against it; a backup that has never been
restored is not a backup.

## Moving an existing PostgreSQL installation to MongoDB

A one-off copy, done once per environment during a short maintenance window:

1. Take a PostgreSQL backup with the **old** release's `infra/scripts/backup.sh` (pg_dump).
2. Stop the API and worker (scale the ECS services to 0, or `docker compose stop api worker`).
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

In production give the API a database user with `readWrite` on the `zapx` database only. Terraform creates that user
(`mongodbatlas_database_user`) and puts its name and password in the `zapx-<env>/database` secret; the tasks
receive them as `DB_USER` and `DB_PASSWORD`, and reach the cluster only over AWS PrivateLink.
