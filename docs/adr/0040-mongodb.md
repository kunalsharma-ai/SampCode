# 0040: MongoDB replaces PostgreSQL (Prisma stays)

Status: Accepted (2026-11-09). Supersedes the PostgreSQL parts of ADR 0002 and ADR 0012 (row-level security).

## Context

The owner decided SampCode should run on MongoDB instead of PostgreSQL. ADR 0002 made Prisma the only way the
code reaches the database, and Prisma has a MongoDB connector, so the services, controllers and tests keep their
Prisma calls. What did not carry over:

- 33 raw SQL statements (`$queryRaw` / `$executeRaw`): queue claims with `FOR UPDATE SKIP LOCKED`, atomic quota
  counters, the rate-limit upsert, dashboard and wave statistics, the CATI dialer pick, GDPR erasure.
- `createMany({ skipDuplicates })`, JSON path filters and `nulls: 'last'`, which the MongoDB connector lacks.
- Row-level security (ADR 0012) and versioned SQL migrations.
- Two composite primary keys (`ProjectMember`, `BlockExposure`); MongoDB ids are one field (`_id`).
- NULL semantics. In MongoDB a value can be null **or missing**; Prisma leaves optional fields out of new
  documents, but its `{ field: null }` filter only matches an explicit null, and `lt`/`lte` match null.
  A unique index also counts every missing value as the same value.

## Decision

1. **Prisma with `provider = "mongodb"`.** Every model id is `@map("_id")`; ids stay cuid strings. The two
   composite keys became an `id` plus a `@@unique` with the same fields, so `findUnique({ where: { projectId_userId } })`
   still works. MongoDB 7 or newer, run as a **replica set** (Prisma needs one for transactions).
2. **`@zapx/db` exports its own `PrismaClient`** (packages/db/src/client.ts). Always import it from `@zapx/db`:
   - a middleware (mongo-nulls.ts) rewrites `field: null` / `equals: null` on optional fields into "null or not set",
     and adds `not: null` to `lt`/`lte` filters on optional fields, at every nesting level, so filters behave as on SQL;
   - interactive transactions retry on a MongoDB write conflict (P2034). PostgreSQL made a second writer wait for the
     row lock; MongoDB aborts it, so a retry gives the same result. Keep side effects outside transaction callbacks.
3. **Indexes come from schema.prisma, applied by our own sync** (`pnpm db:migrate` → packages/db/src/sync-indexes.ts,
   the ECS migrate task runs the same through apps/api/dist/cli/migrate.js). It creates every collection and every
   `@unique`, `@@unique` and `@@index` under Prisma's names. A unique index that covers an optional field is a
   **partial** index (`{ field: { $gt: '' } }`), which matches PostgreSQL (many rows may have no value) and still
   serves equality lookups. Do not run `prisma db push`: it would recreate those as plain unique indexes.
   `prisma/migrations` is gone (it is in git history); schema changes need no migration file, only a release that
   runs the sync. Data reshaping, when needed, is a one-off script.
4. **SQL replacements** (apps/api/src/common/mongo.ts):
   - queue claims (jobs, automation runs, webhooks, vendor callbacks, CATI cases): read candidates, then a conditional
     `updateMany` on each id (`claimQueued`); a row another worker took in between is skipped;
   - quota places and the rate limiter: single server-side updates (`$expr`, update pipelines with `$$NOW`);
   - skip-duplicates inserts: `createSkippingDuplicates` (createMany per 1000, row by row only for a chunk that hits a
     duplicate) and `createUnlessDuplicate` for single rows;
   - statistics: `aggregateRaw` pipelines or two indexed reads joined in code.
5. **Tenant isolation**: `PrismaService.forTenant(tenantId)` is now a Prisma extension that adds `tenantId` to every
   filter on a model with a required `tenantId`, stamps it on creates and refuses a create for another tenant. Settings
   > Security still reports `rowLevelSecurity: "enforced"`, meaning this guard. It is enforced in the API, not by the
   > database: a database user with read access sees every tenant, so give the application user access to the
   > SampCode database only, and nobody else.

## Consequences

- No PostgreSQL anywhere: Docker Compose, CI and `pnpm check` start a one-member MongoDB replica set; AWS uses
  MongoDB Atlas (see the Terraform and DEPLOYMENT docs). Existing PostgreSQL data moves with the one-off copy script
  in `packages/db/scripts/` (see docs/operations/database.md).
- Raw MongoDB commands (`$runCommandRaw`, `aggregateRaw`, `findRaw`) use collection and field names as in the schema
  (models have no `@@map`; only ids map to `_id`) and MongoDB extended JSON for dates (`{ $date: iso }`).
- Sorting: MongoDB puts missing values first when ascending and compares strings by code point (capitals first);
  PostgreSQL put NULLs last and used the locale collation. No screen depended on either; keep it in mind for new sorts.
- A duplicate key inside an interactive transaction aborts the whole transaction on MongoDB: check first, or insert
  outside the transaction.
- `$use` middleware is deprecated in later Prisma releases; before upgrading Prisma past 6.x, move it to a query
  extension.
