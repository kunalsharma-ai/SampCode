/**
 * What row locks, ON CONFLICT and NULL comparisons guaranteed on PostgreSQL, checked on MongoDB:
 * parallel quota takes never overfill a cell, parallel lease claims never hand the same row to two
 * workers, duplicate-skipping inserts stay idempotent under races, and filters treat null as
 * PostgreSQL did.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SurveyDefinition } from '@zapx/survey-schema';
import { withNulls } from '@zapx/db';
import { PrismaService } from '../src/common/prisma.service';
import { claim, createManySkipDuplicates } from '../src/common/mongo-compat';
import { takeQuotaPlaces } from '../src/quotas/quota-places';

const run = Date.now().toString(36);
let prisma: PrismaService;

beforeAll(async () => {
  prisma = new PrismaService();
  await prisma.onModuleInit();
});
afterAll(async () => {
  await prisma.onModuleDestroy();
});

describe('MongoDB in place of PostgreSQL row locks', () => {
  it('parallel completes on a quota of 3 take exactly 3 places', async () => {
    const surveyId = `s-${run}-quota`;
    await prisma.quotaCount.create({ data: { surveyId, quotaId: 'Q1', count: 0 } });
    const def = { pages: [], quotas: [{ id: 'Q1', condition: 'true', target: 3 }] } as unknown as SurveyDefinition;
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prisma.$transaction(async (tx) => {
          const r = await takeQuotaPlaces(tx, surveyId, def, {});
          return r.ok;
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await prisma.quotaCount.findFirstOrThrow({ where: { surveyId } })).count).toBe(3);
  });

  it('parallel workers never claim the same webhook delivery', async () => {
    const webhookId = `w-${run}`;
    const now = new Date(Date.now() - 1000);
    await prisma.webhookDelivery.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        tenantId: `t-${run}`,
        webhookId,
        event: `test.${i}`,
        payload: {},
        nextAttemptAt: now,
      })),
    });
    const where = { webhookId, state: 'PENDING' as const, nextAttemptAt: { lte: new Date() } };
    const lease = { nextAttemptAt: new Date(Date.now() + 60_000) };
    const claimed = (
      await Promise.all(Array.from({ length: 6 }, () => claim(prisma.webhookDelivery, where, { nextAttemptAt: 'asc' }, 5, lease)))
    ).flat();
    expect(claimed).toHaveLength(12);
    expect(new Set(claimed).size).toBe(12);
  });

  it('duplicate-skipping inserts count each row once, even when run in parallel', async () => {
    const tenantId = `t-${run}-dnc`;
    const rows = ['a', 'b', 'c', 'a'].map((h) => ({ tenantId, phoneHash: `${run}-${h}`, hint: '123', source: 'manual' }));
    const counts = await Promise.all(Array.from({ length: 4 }, () => createManySkipDuplicates(prisma.doNotCall, 'DoNotCall', rows)));
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(3);
    expect(await prisma.doNotCall.count({ where: { tenantId } })).toBe(3);
    expect((await createManySkipDuplicates(prisma.doNotCall, 'DoNotCall', rows)).count).toBe(0);
  });

  it('lets any number of rows leave an optional unique field empty, as PostgreSQL did', async () => {
    const surveyId = `s-${run}-contacts`;
    for (let i = 0; i < 3; i++) await prisma.contact.create({ data: { tenantId: `t-${run}`, surveyId, name: `C${i}`, fields: {} } });
    expect(await prisma.contact.count({ where: { surveyId, email: null } })).toBe(3);
    await prisma.contact.create({ data: { tenantId: `t-${run}`, surveyId, email: 'x@example.com', fields: {} } });
    await expect(prisma.contact.create({ data: { tenantId: `t-${run}`, surveyId, email: 'x@example.com', fields: {} } })).rejects.toThrow();
  });

  it('leaves null out of comparisons, as PostgreSQL did', async () => {
    const surveyId = `s-${run}-nulls`;
    const past = new Date(Date.now() - 60_000);
    await prisma.contact.create({ data: { tenantId: `t-${run}`, surveyId, name: 'never', fields: {} } });
    await prisma.contact.create({ data: { tenantId: `t-${run}`, surveyId, name: 'gone', unsubscribedAt: past, fields: {} } });
    const names = async (where: object) =>
      (await prisma.contact.findMany({ where: { surveyId, ...where }, select: { name: true } })).map((c) => c.name).sort();
    expect(await names({ unsubscribedAt: null })).toEqual(['never']);
    expect(await names({ unsubscribedAt: { not: null } })).toEqual(['gone']);
    expect(await names({ unsubscribedAt: { lt: new Date() } })).toEqual(['gone']);
    expect(await names({ unsubscribedAt: { gt: new Date(0) } })).toEqual(['gone']);
    expect(await names({ name: { not: 'gone' } })).toEqual(['never']);
    expect(await names({ phone: { not: '1' } })).toEqual([]);
    expect(await names({ NOT: { unsubscribedAt: { lt: new Date() } } })).toEqual([]);
  });

  it('writes null foreign keys on creates that also create child rows or connect by id', () => {
    // A nested child create does not make the input "checked", so vendorId is still written as null.
    const a = withNulls('Response', { tenantId: 't', surveyId: 's', captures: { create: [] } }) as Record<string, unknown>;
    expect(a.vendorId).toBeNull();
    expect(a.interviewerId).toBeNull();
    // A connect by id becomes the foreign key itself, so the other one can be null too.
    const b = withNulls('Response', { tenantId: 't', surveyId: 's', vendor: { connect: { id: 'v1' } } }) as Record<string, unknown>;
    expect(b).toMatchObject({ vendorId: 'v1', interviewerId: null });
    expect(b.vendor).toBeUndefined();
  });
});
