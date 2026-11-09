import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@zapx/db';

/** Models whose rows belong to one tenant (they have a required tenantId field). */
const TENANT_MODELS = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId' && f.isRequired && f.kind === 'scalar'))
    .map((m) => m.name),
);

const READ_OR_WRITE_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Thrown when code tries to write a row into another tenant through a tenant-scoped client. */
export class CrossTenantWriteError extends Error {}

function stampTenant(data: unknown, tenantId: string) {
  for (const row of Array.isArray(data) ? data : [data]) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (r.tenantId === undefined && !('tenant' in r)) r.tenantId = tenantId;
    else if (r.tenantId !== undefined && r.tenantId !== tenantId) throw new CrossTenantWriteError('Row belongs to another organization');
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * Tenant isolation for respondent data. On PostgreSQL this was row-level security; on MongoDB it is the
   * tenant guard of forTenant(), applied in the API to every tenant-owned model. Reported to admins in
   * Settings > Security.
   */
  readonly rls = 'enforced' as const;

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * A client that adds `tenantId = <tenantId>` to every filter on a tenant-owned model (and stamps or
   * checks tenantId on creates), so a query that forgot its tenant filter still cannot read or change
   * another organization's rows. Use it for studio reads of respondent data. This replaces the
   * PostgreSQL row-level security policy (app.tenant_id); it works inside transactions too.
   */
  forTenant(tenantId: string) {
    return this.$extends({
      query: {
        $allModels: {
          $allOperations: async ({ model, operation, args, query }) => {
            if (!TENANT_MODELS.has(model)) return query(args);
            const a = (args ?? {}) as Record<string, unknown>;
            if (READ_OR_WRITE_WHERE.has(operation)) {
              const original = a.where as Record<string, unknown> | undefined;
              // Unique lookups need their unique key at the top level, next to the tenant filter.
              const unique =
                operation.startsWith('findUnique') || operation === 'update' || operation === 'delete' || operation === 'upsert';
              a.where = unique ? { ...original, tenantId } : original ? { AND: [original, { tenantId }] } : { tenantId };
            }
            if (operation === 'create' || operation === 'createMany') stampTenant(a.data, tenantId);
            if (operation === 'upsert') stampTenant(a.create, tenantId);
            return query(a as typeof args);
          },
        },
      },
    });
  }
}
