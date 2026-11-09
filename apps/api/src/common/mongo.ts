/**
 * Helpers for the MongoDB patterns that replaced PostgreSQL-only SQL (raw UPDATE … RETURNING, FOR UPDATE
 * SKIP LOCKED, INSERT … ON CONFLICT DO NOTHING). See docs/adr/0040-mongodb.md.
 */
import { randomBytes } from 'node:crypto';
import { Prisma } from '@zapx/db';

/** A value from $runCommandRaw / aggregateRaw (MongoDB extended JSON) as a Date. */
export function mongoDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && '$date' in v) {
    const d = (v as { $date: unknown }).$date;
    if (typeof d === 'string' || typeof d === 'number') return new Date(d);
    if (d && typeof d === 'object' && '$numberLong' in d) return new Date(Number((d as { $numberLong: string }).$numberLong));
  }
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return null;
}

/** A number from extended JSON ({$numberLong}, {$numberInt}, {$numberDouble}) or a plain number. */
export function mongoNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, string>;
    const s = o.$numberLong ?? o.$numberInt ?? o.$numberDouble ?? o.$numberDecimal;
    if (s !== undefined) return Number(s);
  }
  return Number(v ?? 0);
}

/** A Date as an extended-JSON value for $runCommandRaw / aggregateRaw. */
export const asMongoDate = (d: Date) => ({ $date: d.toISOString() });

export const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/** Creates one row; false (nothing created) when it would break a unique index. */
export async function createUnlessDuplicate(create: () => Promise<unknown>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
}

/** A new document id: time-ordered like cuid, unique without a round trip. */
export const newId = () => `c${Date.now().toString(36)}${randomBytes(9).toString('hex')}`;

type SkipDuplicatesOps<Row> = {
  createMany: (rows: Row[]) => Promise<unknown>;
  create: (row: Row) => Promise<unknown>;
  countIds: (ids: string[]) => Promise<number>;
};

/**
 * What createMany({ skipDuplicates: true }) did on PostgreSQL (MongoDB's Prisma connector has no
 * skipDuplicates): inserts the rows in order, skips the ones that hit a unique index, and returns
 * { count } of rows created. Fast path: one createMany per 1000 rows; only a chunk that hits a duplicate
 * is retried row by row. Rows get their id up front so the count stays exact.
 * Not for use inside an interactive transaction: MongoDB aborts the transaction on a duplicate key.
 */
export async function createSkippingDuplicates<Row extends object>(rows: Row[], ops: SkipDuplicatesOps<Row>): Promise<{ count: number }> {
  let count = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000).map((r) => ({ id: newId(), ...r }) as Row & { id: string });
    try {
      await ops.createMany(chunk);
      count += chunk.length;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      for (const row of chunk)
        await ops.create(row).catch((err: unknown) => {
          if (!isUniqueViolation(err)) throw err;
        });
      count += await ops.countIds(chunk.map((r) => r.id));
    }
  }
  return { count };
}

/**
 * Claims up to `limit` queued rows for this process: the MongoDB form of `UPDATE … WHERE id IN (SELECT …
 * FOR UPDATE SKIP LOCKED) RETURNING *`. `candidates` lists rows that look claimable (oldest first);
 * `claim` makes one conditional update (updateMany with the same conditions plus the id) and returns
 * whether it changed the row, so a row another worker took in between is skipped. `load` reads back the
 * claimed rows.
 */
export async function claimQueued<T extends { id: string }>(opts: {
  limit: number;
  candidates: (take: number) => Promise<Array<{ id: string }>>;
  claim: (id: string) => Promise<boolean>;
  load: (ids: string[]) => Promise<T[]>;
}): Promise<T[]> {
  const ids: string[] = [];
  // Ask for a few extra in case other workers claim some of the same rows.
  for (const c of await opts.candidates(opts.limit * 2)) {
    if (ids.length >= opts.limit) break;
    if (await opts.claim(c.id)) ids.push(c.id);
  }
  if (!ids.length) return [];
  const rows = await opts.load(ids);
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** MongoDB aborts a transaction that touched a document another transaction changed (P2034); retry it. */
export const isWriteConflict = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || /WriteConflict|write conflict/i.test(e.message));

export async function retryOnWriteConflict<T>(run: () => Promise<T>, attempts = 8): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (e) {
      if (i >= attempts || !isWriteConflict(e)) throw e;
      await new Promise((r) => setTimeout(r, Math.min(200, 5 * 2 ** i) + Math.random() * 20));
    }
  }
}
