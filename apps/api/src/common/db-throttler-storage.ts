import { Logger } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { config } from '../config';
import { mongoDate, mongoNumber } from './mongo';
import { PrismaService } from './prisma.service';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

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
 * `blockDuration`. One atomic findAndModify per request. If the database cannot be reached the request is counted
 * in this process instead (logged), so the limiter never becomes the reason the API is down.
 */
export class DbThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger('RateLimit');
  private readonly fallback = new ThrottlerStorageService();
  private sweeper?: NodeJS.Timeout;
  private warned = 0;

  constructor(private readonly prisma: PrismaService) {}

  async sweep(): Promise<number> {
    const graceEnd = new Date(Date.now() - 60_000);
    try {
      const { count } = await this.prisma.rateLimitBucket.deleteMany({
        where: { windowEnds: { lt: graceEnd }, OR: [{ blockedUntil: null }, { blockedUntil: { lt: graceEnd } }] },
      });
      return count;
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
      // One atomic upsert (an update pipeline evaluated on the server with $$NOW). While blocked, hits are
      // not counted; once a window or block has ended the count restarts.
      const blockedUntil = { $ifNull: ['$blockedUntil', null] };
      const res = (await this.prisma.$runCommandRaw({
        findAndModify: 'RateLimitBucket',
        query: { _id: id },
        upsert: true,
        new: true,
        update: [
          {
            $set: {
              _blocked: { $gt: [blockedUntil, '$$NOW'] },
              _reset: { $or: [{ $lte: [{ $ifNull: ['$windowEnds', null] }, '$$NOW'] }, { $ne: [blockedUntil, null] }] },
            },
          },
          {
            $set: {
              hits: { $cond: ['$_blocked', '$hits', { $cond: ['$_reset', 1, { $add: ['$hits', 1] }] }] },
              windowEnds: { $cond: ['$_blocked', '$windowEnds', { $cond: ['$_reset', { $add: ['$$NOW', ttl] }, '$windowEnds'] }] },
              blockedUntil: { $cond: ['$_blocked', '$blockedUntil', null] },
            },
          },
          { $unset: ['_blocked', '_reset'] },
        ],
      } as never)) as { value: { hits: unknown; windowEnds: unknown; blockedUntil: unknown } };
      const now = Date.now();
      const row = {
        hits: mongoNumber(res.value.hits),
        expires_in: ((mongoDate(res.value.windowEnds)?.getTime() ?? now) - now) / 1000,
        blocked_for: res.value.blockedUntil ? ((mongoDate(res.value.blockedUntil)?.getTime() ?? now) - now) / 1000 : null,
      } satisfies Row;
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
