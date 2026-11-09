import { ForbiddenException } from '../http/errors';
import type { OnModuleDestroy, OnModuleInit } from '../http/lifecycle';
import { Prisma, PrismaClient } from '@zapx/db';

/**
 * Models that hold respondent or contact data for one tenant. On PostgreSQL these had a row-level
 * security policy keyed on app.tenant_id; on MongoDB the same rule is applied by forTenant below.
 */
export const TENANT_ISOLATED_MODELS = new Set<string>([
  'Response',
  'Capture',
  'SampleonAudienceRequest',
  'CatiCase',
  'CatiCall',
  'DoNotCall',
  'Contact',
  'Invitation',
  'BackCheck',
  'QualityAppeal',
]);

const READS_AND_WRITES_BY_WHERE = new Set([
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
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

/** Write conflicts between concurrent MongoDB transactions: safe to run the transaction again. */
const isWriteConflict = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034';

type AnyArgs = { where?: Record<string, unknown>; data?: unknown; create?: unknown } & Record<string, unknown>;

/** Add `tenantId = tenantId` to a where clause, keeping it a valid unique where for findUnique etc. */
export function scopeWhere(where: Record<string, unknown> | undefined, tenantId: string) {
  const and = where?.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
  return { ...(where ?? {}), AND: [...and, { tenantId }] };
}

function checkData(model: string, data: unknown, tenantId: string) {
  for (const row of Array.isArray(data) ? data : [data]) {
    const t = (row as { tenantId?: unknown } | undefined)?.tenantId;
    if (t !== undefined && t !== tenantId) throw new ForbiddenException(`${model} belongs to another organization`);
  }
}

export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * How tenant isolation of respondent data is applied. On PostgreSQL this reported whether the
   * database role was subject to row-level security; MongoDB has no such policies, so the
   * isolation is applied by forTenant in the application and is always 'enforced'.
   */
  rls: 'enforced' | 'bypassed' | 'unknown' = 'enforced';

  constructor() {
    super();
    // MongoDB aborts one of two transactions that write the same document at the same time
    // (P2034). PostgreSQL made the second one wait on the row lock; here it runs again.
    const original = this.$transaction.bind(this) as (...a: unknown[]) => Promise<unknown>;
    const retrying = async (arg: unknown, opts?: unknown) => {
      if (typeof arg !== 'function') return original(arg, opts);
      for (let attempt = 1; ; attempt++) {
        try {
          return await original(arg, opts);
        } catch (e) {
          if (!isWriteConflict(e) || attempt >= 8) throw e;
          await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 20 * attempt)));
        }
      }
    };
    (this as unknown as { $transaction: unknown }).$transaction = retrying;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** A cheap round trip to the database, for health checks. */
  async ping() {
    await this.$runCommandRaw({ ping: 1 });
  }

  /**
   * A client that only sees and writes the given tenant's respondent data (the models in
   * TENANT_ISOLATED_MODELS), even if an application filter is missing: every where gets
   * `tenantId` added, and a create for another tenant is refused. It fails closed: without a tenant
   * id it refuses every query. Other models pass through unchanged. Use it for studio reads of
   * respondent data.
   */
  forTenant(tenantId: string) {
    if (!tenantId) throw new ForbiddenException('No organization for this request');
    return this.$extends({
      query: {
        $allModels: {
          $allOperations: async ({ model, operation: op, args, query }) => {
            const operation = op as string;
            if (!TENANT_ISOLATED_MODELS.has(model)) return query(args);
            const a = { ...(args as AnyArgs) };
            if (READS_AND_WRITES_BY_WHERE.has(operation)) a.where = scopeWhere(a.where, tenantId);
            if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn')
              checkData(model, a.data, tenantId);
            if (operation === 'update' || operation === 'updateMany') checkData(model, a.data, tenantId);
            if (operation === 'upsert') {
              checkData(model, a.create, tenantId);
              checkData(model, a.update, tenantId);
            }
            return query(a as typeof args);
          },
        },
      },
    });
  }
}
