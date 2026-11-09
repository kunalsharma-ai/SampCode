import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { config } from '../config';
import { PrismaService } from './prisma.service';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** A date as $runCommandRaw returns it (extended JSON). */
type MongoDate = { $date: string | { $numberLong: string } } | string;
const dateOf = (d: MongoDate) =>
  typeof d === 'string' ? Date.parse(d) : typeof d.$date === 'string' ? Date.parse(d.$date) : Number(d.$date.$numberLong);

interface Row {
  hits: number;
  expires_in: number;
  blocked_for: number | null;
}

/**
 * Rate-limit counters in the database (security review S4), so every API process counts against the
 * same limit: with the default in-memory store two tasks allowed twice the configured rate, and
 * autoscaling changed the real limit. Chosen with THROTTLE_STORE (default `database` in production).
 *
 * Fixed windows: the first hit opens a window of `ttl`; hits above `limit` block the key for
 * `blockDuration`. One upsert per request. If the database cannot be reached the request is counted
 * in this process instead (logged), so the limiter never becomes the reason the API is down.
 */
export class DbThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger('RateLimit');
  private readonly fallback = new ThrottlerStorageService();
  private sweeper?: NodeJS.Timeout;
  private warned = 0;

  constructor(private readonly prisma: PrismaService) {}

  async sweep(): Promise<number> {
    try {
      const graceEnd = new Date(Date.now() - 60_000);
      const r = await this.prisma.rateLimitBucket.deleteMany({
        where: { windowEnds: { lt: graceEnd }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: graceEnd } }] },
      });
      return r.count;
    } catch {
      return 0;
    }
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const id = `${throttlerName}:${key}`;
    if (!this.sweeper) {
      // Every 5 minutes, remove counters whose window and block both ended (a minute of grace).
      this.sweeper = setInterval(() => void this.sweep(), 5 * 60_000);
      this.sweeper.unref();
    }
    try {
      // While blocked, hits are not counted; once a window or block has ended the count restarts.
      // One atomic update on the database clock ($$NOW), creating the counter on the first hit.
      const res = (await this.prisma.$runCommandRaw({
        findAndModify: 'RateLimitBucket',
        query: { _id: id },
        upsert: true,
        new: true,
        update: [
          {
            $set: {
              _blocked: { $gt: ['$blockedUntil', '$$NOW'] },
              _restart: { $or: [{ $lte: ['$windowEnds', '$$NOW'] }, { $ne: [{ $ifNull: ['$blockedUntil', null] }, null] }] },
            },
          },
          {
            $set: {
              hits: { $cond: ['$_blocked', '$hits', { $cond: ['$_restart', 1, { $add: ['$hits', 1] }] }] },
              windowEnds: { $cond: ['$_blocked', '$windowEnds', { $cond: ['$_restart', { $add: ['$$NOW', ttl] }, '$windowEnds'] }] },
              blockedUntil: { $cond: ['$_blocked', '$blockedUntil', null] },
              now: '$$NOW',
            },
          },
          { $unset: ['_blocked', '_restart'] },
        ],
      } as never)) as unknown as { value: { hits: number; windowEnds: MongoDate; blockedUntil: MongoDate | null; now: MongoDate } };
      const v = res.value;
      const now = dateOf(v.now);
      const row: Row = {
        hits: v.hits,
        expires_in: (dateOf(v.windowEnds) - now) / 1000,
        blocked_for: v.blockedUntil ? (dateOf(v.blockedUntil) - now) / 1000 : null,
      };
      let blockedFor = row.blocked_for;
      if (blockedFor === null && row.hits > limit) {
        await this.prisma.rateLimitBucket.update({ where: { key: id }, data: { blockedUntil: new Date(now + blockDuration) } });
        blockedFor = blockDuration / 1000;
      }
      return {
        totalHits: row.hits,
        timeToExpire: Math.max(0, Math.ceil(row.expires_in)),
        isBlocked: blockedFor !== null && blockedFor > 0,
        timeToBlockExpire: blockedFor !== null ? Math.max(0, Math.ceil(blockedFor)) : 0,
      };
    } catch (e) {
      if (Date.now() - this.warned > 60_000) {
        this.warned = Date.now();
        this.log.warn(`Shared rate-limit store unavailable, counting in this process: ${(e as Error).message}`);
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}

/** Which store the throttler uses: shared in the database, or per process. */
export function throttleStore(): 'database' | 'memory' {
  const c = config();
  return c.THROTTLE_STORE ?? (c.NODE_ENV === 'production' ? 'database' : 'memory');
}
