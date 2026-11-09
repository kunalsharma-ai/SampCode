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

|                       | Local / single server                                    | Managed (Atlas or DocumentDB)                           |
| --------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Continuous            | –                                                        | continuous backup with point-in-time recovery           |
| Daily                 | `infra/scripts/backup.sh` (mongodump archive, keeps 14)  | daily snapshots, 35 days                                |
| Before risky releases | `infra/scripts/backup.sh`                                | on-demand snapshot                                      |
| Restore               | `infra/scripts/restore.sh <file>` into an empty database | restore to a new cluster, verify, switch the connection |

Targets to agree with customers: RPO ≤ 5 minutes (PITR), RTO ≤ 1 hour. **Test a restore every
quarter** into a scratch database and run `pnpm test` against it; a backup that has never been
restored is not a backup.

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

In production give the API a database user with `readWrite` on the `zapx` database only.
