import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { HttpException } from './errors';

export interface ThrottleRecord {
  totalHits: number;
  /** Seconds until the window ends. */
  timeToExpire: number;
  isBlocked: boolean;
  /** Seconds until the block ends (0 when not blocked). */
  timeToBlockExpire: number;
}

/** Where hit counters live: this process (MemoryThrottleStore) or the database (DbThrottlerStorage). */
export interface ThrottleStore {
  increment(key: string, ttl: number, limit: number, blockDuration: number, name: string): Promise<ThrottleRecord>;
}

/** Limit for one route: `limit` requests per `ttl` milliseconds per client address. */
export interface ThrottleLimit {
  limit: number | (() => number);
  ttl: number;
}

/** Every route not given its own limit: 600 requests a minute per address. */
export const DEFAULT_THROTTLE: ThrottleLimit = { limit: 600, ttl: 60_000 };

/** Fixed windows in this process: the first hit opens a window of `ttl`; hits above `limit` block for `blockDuration`. */
export class MemoryThrottleStore implements ThrottleStore {
  private readonly buckets = new Map<string, { hits: number; windowEnds: number; blockedUntil: number }>();
  private sweeps = 0;

  async increment(key: string, ttl: number, limit: number, blockDuration: number, name: string): Promise<ThrottleRecord> {
    const now = Date.now();
    const id = `${name}:${key}`;
    if (++this.sweeps % 1000 === 0)
      for (const [k, b] of this.buckets) if (b.windowEnds < now && b.blockedUntil < now) this.buckets.delete(k);
    let b = this.buckets.get(id);
    if (!b || (b.windowEnds <= now && b.blockedUntil <= now) || (b.blockedUntil && b.blockedUntil <= now)) {
      b = { hits: 0, windowEnds: now + ttl, blockedUntil: 0 };
      this.buckets.set(id, b);
    }
    const blocked = b.blockedUntil > now;
    if (!blocked) b.hits++;
    if (!blocked && b.hits > limit) b.blockedUntil = now + blockDuration;
    return {
      totalHits: b.hits,
      timeToExpire: Math.max(0, Math.ceil((b.windowEnds - now) / 1000)),
      isBlocked: b.blockedUntil > now,
      timeToBlockExpire: b.blockedUntil > now ? Math.ceil((b.blockedUntil - now) / 1000) : 0,
    };
  }
}

export class ThrottledException extends HttpException {
  constructor() {
    super({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }, 429);
  }
}

/** Counts one request against the route's limit; throws 429 when over it. Sets the X-RateLimit-* headers. */
export async function throttle(store: ThrottleStore, route: string, limit: ThrottleLimit, req: Request, res: Response) {
  const max = typeof limit.limit === 'function' ? limit.limit() : limit.limit;
  const key = createHash('sha256')
    .update(`${route}-default-${req.ip ?? ''}`)
    .digest('hex');
  const r = await store.increment(key, limit.ttl, max, limit.ttl, 'default');
  if (r.isBlocked) {
    res.setHeader('Retry-After', String(r.timeToBlockExpire));
    throw new ThrottledException();
  }
  res.setHeader('X-RateLimit-Limit', String(max));
  res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - r.totalHits)));
  res.setHeader('X-RateLimit-Reset', String(r.timeToExpire));
}
