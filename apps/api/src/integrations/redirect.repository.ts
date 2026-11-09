import type { CallbackState, OutboundCallback, Prisma, Project, Response, Tenant, Vendor } from '@zapx/db';
import { type PrismaService } from '../common/prisma.service';
import { claim, createManySkipDuplicates } from '../common/mongo-compat';

export interface VendorContext {
  vendor: Vendor;
  project: Project;
  tenant: Tenant;
}

export interface NewRedirectEvent {
  tenantId: string;
  surveyId: string;
  responseId: string | null;
  vendorId: string | null;
  uid: string;
  status: string;
  statusWord: string;
  source: string;
  level: string | null;
  url: string | null;
  reason: string | null;
  isTest: boolean;
}

export interface NewCallback {
  tenantId: string;
  vendorId: string;
  responseId: string;
  status: string;
  idempotencyKey: string;
  integration: Vendor['integration'];
  method: string;
  url: string;
  payload: Record<string, string> | null;
  maxAttempts: number;
}

export interface AttemptLog {
  at: string;
  httpStatus: number | null;
  error: string | null;
  ms: number;
}

export class RedirectRepository {
  constructor(private readonly prisma: PrismaService) {}

  async vendorContext(vendorId: string): Promise<VendorContext | null> {
    const vendor = await this.prisma.vendor.findUnique({ where: { id: vendorId }, include: { project: { include: { tenant: true } } } });
    if (!vendor) return null;
    const { project, ...v } = vendor;
    const { tenant, ...p } = project;
    return { vendor: v as Vendor, project: p as Project, tenant };
  }

  /** Recorded once per response and status; rejections without a response are always recorded. */
  async recordRedirect(e: NewRedirectEvent) {
    await createManySkipDuplicates(this.prisma.redirectEvent, 'RedirectEvent', [{ ...e }]);
  }

  /** Idempotent: a second outcome with the same key is ignored. Returns true when queued. */
  async enqueueCallback(c: NewCallback): Promise<boolean> {
    const r = await createManySkipDuplicates(this.prisma.outboundCallback, 'OutboundCallback', [
      { ...c, payload: (c.payload ?? undefined) as Prisma.InputJsonValue | undefined },
    ]);
    return r.count === 1;
  }

  /**
   * Claim due callbacks for delivery. The lease (nextAttemptAt pushed forward) keeps other
   * workers away; if this worker dies, the callback becomes due again when the lease expires.
   */
  async claimDue(limit: number, leaseMs: number): Promise<OutboundCallback[]> {
    const now = new Date();
    const ids = await claim(
      this.prisma.outboundCallback,
      { state: 'PENDING', nextAttemptAt: { lte: now } },
      { nextAttemptAt: 'asc' },
      limit,
      { nextAttemptAt: new Date(now.getTime() + leaseMs) },
    );
    return this.prisma.outboundCallback.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' } });
  }

  async saveAttempt(
    cb: OutboundCallback,
    result: { state: CallbackState; httpStatus: number | null; error: string | null; nextAttemptAt: Date | null; log: AttemptLog },
  ) {
    const log = [result.log, ...((cb.log as unknown as AttemptLog[]) ?? [])].slice(0, 10);
    await this.prisma.outboundCallback.update({
      where: { id: cb.id },
      data: {
        state: result.state,
        attempts: { increment: 1 },
        lastHttpStatus: result.httpStatus,
        lastError: result.error,
        nextAttemptAt: result.nextAttemptAt ?? undefined,
        deliveredAt: result.state === 'DELIVERED' ? new Date() : undefined,
        log: log as unknown as Prisma.InputJsonValue,
      },
    });
  }

  listCallbacks(tenantId: string, vendorId: string, take = 100) {
    return this.prisma.outboundCallback.findMany({ where: { tenantId, vendorId }, orderBy: { createdAt: 'desc' }, take });
  }

  callbackCounts(tenantId: string, vendorId: string) {
    return this.prisma.outboundCallback.groupBy({ by: ['state'], where: { tenantId, vendorId }, _count: { _all: true } });
  }

  findCallback(tenantId: string, id: string) {
    return this.prisma.outboundCallback.findFirst({ where: { id, tenantId } });
  }

  /** Manual replay: a fresh set of attempts, keeping the idempotency key. */
  replay(id: string, maxAttempts: number) {
    return this.prisma.outboundCallback.update({
      where: { id },
      data: { state: 'PENDING', attempts: 0, maxAttempts, nextAttemptAt: new Date(), lastError: null },
    });
  }

  listRedirectEvents(tenantId: string, vendorId: string, take = 100) {
    return this.prisma.redirectEvent.findMany({ where: { tenantId, vendorId }, orderBy: { createdAt: 'desc' }, take });
  }

  /** Mark stale unfinished interviews as partial. Returns the responses that changed. */
  async abandonStale(cutoff: Date, limit: number): Promise<Response[]> {
    const stale = await this.prisma.response.findMany({
      where: { status: 'IN_PROGRESS', updatedAt: { lt: cutoff } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    const changed: Response[] = [];
    for (const r of stale) {
      const n = await this.prisma.response.updateMany({
        where: { id: r.id, status: 'IN_PROGRESS', updatedAt: { lt: cutoff } },
        data: { status: 'PARTIAL', outcomeReason: 'abandoned', currentPage: -1, completedAt: new Date() },
      });
      if (n.count === 1) changed.push({ ...r, status: 'PARTIAL', outcomeReason: 'abandoned', currentPage: -1 });
    }
    return changed;
  }

  // ---- Vendor API ------------------------------------------------------------------------------

  findVendorForApi(id: string) {
    return this.prisma.vendor.findFirst({ where: { id, deletedAt: null } });
  }

  outcomesForVendor(vendorId: string, opts: { since?: Date; surveyId?: string; uid?: string; take: number }) {
    return this.prisma.response.findMany({
      where: {
        vendorId,
        isTest: false,
        status: { not: 'IN_PROGRESS' },
        ...(opts.since ? { completedAt: { gt: opts.since } } : {}),
        ...(opts.surveyId ? { surveyId: opts.surveyId } : {}),
        ...(opts.uid ? { uid: opts.uid } : {}),
      },
      orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
      take: opts.take,
      select: { id: true, surveyId: true, uid: true, status: true, country: true, startedAt: true, completedAt: true },
    });
  }
}
