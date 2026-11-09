import { PrismaClient as BaseClient, Prisma } from '@prisma/client';
import { nullFilterMiddleware } from './mongo-nulls';

/** MongoDB aborts a transaction that changed a document another transaction changed first. */
const isWriteConflict = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || /WriteConflict|write conflict/i.test(e.message));

const TX_ATTEMPTS = 8;

/**
 * Prisma client for SampCode's MongoDB database. Same API as Prisma's own client, plus:
 * - `field: null` filters also match documents where the field is not set (mongo-nulls.ts);
 * - interactive transactions (`$transaction(async (tx) => …)`) run again when MongoDB reports a write
 *   conflict. On PostgreSQL a second writer waited for the row lock; on MongoDB it fails at once, so the
 *   retry gives the same outcome. Keep side effects (HTTP calls, e-mails) outside transaction callbacks.
 * Always import PrismaClient from @zapx/db, never from @prisma/client.
 */
export class PrismaClient extends BaseClient {
  constructor(options?: Prisma.PrismaClientOptions) {
    super(options);
    this.$use(nullFilterMiddleware);
    const run = this.$transaction.bind(this) as (arg: unknown, options?: unknown) => Promise<unknown>;
    const retrying = async (arg: unknown, options?: unknown) => {
      if (typeof arg !== 'function') return run(arg, options);
      for (let attempt = 1; ; attempt++) {
        try {
          return await run(arg, options);
        } catch (e) {
          if (attempt >= TX_ATTEMPTS || !isWriteConflict(e)) throw e;
          await new Promise((r) => setTimeout(r, Math.min(250, 5 * 2 ** attempt) + Math.random() * 25));
        }
      }
    };
    Object.defineProperty(this, '$transaction', { value: retrying, writable: true, configurable: true });
  }
}
