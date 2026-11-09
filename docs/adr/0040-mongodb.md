# ADR 0040: MongoDB in place of PostgreSQL

Status: accepted (2026-11-09). Supersedes the PostgreSQL parts of [ADR 0002](0002-prisma-and-repository-boundaries.md)
and [ADR 0012](0012-row-level-security.md).

## Context

The Sampledge systems are moving to one database technology, MongoDB (SampAudience moved first).
SampCode used PostgreSQL 16 through Prisma 6, with about twenty raw SQL statements (row locks,
`SKIP LOCKED` claims, `ON CONFLICT`, a median, date grouping, row-level security) and 30 SQL
migrations.

## Decision

SampCode keeps Prisma 6 and NestJS (on Express) and switches the Prisma provider to `mongodb`.
The API contracts, the respondent links and the integrations with SampAudience, SampTrek and
SUPPLY360 do not change.

- **Schema.** Every id is mapped to `_id`. The two composite primary keys (`ProjectMember`,
  `BlockExposure`) became `@@unique` with their own `id`.
- **Indexes instead of migrations.** `packages/db/src/indexes.ts` reads `schema.prisma` and creates
  every collection and index (`pnpm db:migrate`, or the `migrate` image). Unique indexes on optional
  fields are partial, so any number of rows can leave the field empty, as in PostgreSQL. The SQL
  migrations were removed. `prisma db push` is not used.
- **NULL semantics.** On PostgreSQL every row has every column and NULL takes no part in a
  comparison. `@zapx/db`'s `PrismaClient` keeps that: creates write `null` for unset optional fields
  (so `{ deletedAt: null }` still finds them), and filters are rewritten so `lt`, `lte`, `not`,
  `notIn` and anything under `NOT` leave null out (`packages/db/src/compat.ts`).
- **Row locks.** A MongoDB transaction that writes a document another transaction changed aborts
  with a write conflict (Prisma `P2034`). `PrismaService.$transaction` runs the transaction again,
  up to 8 times. Quota places are taken with an update guarded on the count just read.
- **Claims.** `FOR UPDATE SKIP LOCKED` claims (jobs, automation runs, webhooks, vendor callbacks,
  CATI cases) became `claim()` in `apps/api/src/common/mongo-compat.ts`: an update that only
  succeeds while the row still matches, trying the next candidate when another worker won.
- **`ON CONFLICT DO NOTHING`.** `createMany({ skipDuplicates })` is not available on MongoDB;
  `createManySkipDuplicates()` reads the unique keys from the Prisma schema and inserts only rows that
  do not clash, also under races.
- **Tenant isolation.** PostgreSQL row-level security became `PrismaService.forTenant()`: on the ten
  respondent-data models it adds `tenantId` to every filter and refuses writes for another tenant.
  It fails closed (no tenant id, no query). `GET /api/audit/security` reports `enforced`.
- **Reports.** The median, daily counts and invitation joins use aggregation pipelines.
- **Rate limits.** The shared throttler store is one atomic `findAndModify` with a pipeline update,
  on the database clock.
- MongoDB 7 or later as a replica set (a one-member set locally) is required for transactions.

## Consequences

- `docker compose up mongo` starts a one-member replica set; CI starts the same with `docker run`.
- Backups are `mongodump`/`mongorestore` (`infra/scripts/backup.sh`, `restore.sh`).
- PostgreSQL sorted NULL last in ascending order; MongoDB sorts it first. No screen relied on it
  (members are listed by `lastSeenAt` descending, which puts never-seen members last on both).
- Nested `include`s of respondent data are not filtered by `forTenant`, as RLS would have done;
  every studio query also filters `tenantId` itself (the first line of defence, unchanged).
- **Not changed yet:** `infra/terraform` still provisions RDS PostgreSQL. Moving AWS to MongoDB Atlas
  or Amazon DocumentDB (with transactions) is a separate change before the next AWS release.
