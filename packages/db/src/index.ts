import { PrismaClient as BaseClient, type Prisma } from '@prisma/client';
import { installMongoCompat } from './compat';

export * from '@prisma/client';
export { syncIndexes, schemaIndexes, indexesFromSchema, type IndexSpec } from './indexes';
export { withNulls } from './compat';

/**
 * The Prisma client for SampCode's MongoDB database. Unset optional fields are written as null, so
 * `{ field: null }` finds rows where it is not set, as it did on PostgreSQL (see compat.ts).
 */
export class PrismaClient extends BaseClient {
  constructor(options?: Prisma.PrismaClientOptions) {
    super(options);
    installMongoCompat(this);
  }
}
