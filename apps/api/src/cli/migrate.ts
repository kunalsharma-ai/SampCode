/**
 * Operator command: create the MongoDB collections and sync their indexes with schema.prisma, then exit.
 * The ECS migration task runs it before each release; it accepts DATABASE_URL or the DB_* parts (see
 * database-url.ts). Safe to run again: it changes only what differs.
 *
 *   node apps/api/dist/cli/migrate.js
 */
import '../database-url';
import { PrismaClient, syncIndexes } from '@zapx/db';

const prisma = new PrismaClient();
syncIndexes(prisma)
  .catch((e: Error) => {
    console.error(`Could not prepare the database: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
