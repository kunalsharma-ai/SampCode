export * from '@prisma/client';
// Overrides @prisma/client's PrismaClient (a local export wins over `export *`).
export { PrismaClient } from './client';
export { widenNullFilters } from './mongo-nulls';
export { indexSpecs, type IndexSpec } from './indexes';
export { syncIndexes } from './sync-indexes';
