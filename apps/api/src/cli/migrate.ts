/**
 * Operator command (Milestone 13): create the MongoDB collections and indexes, then exit. The ECS
 * migration task runs it before each release; it accepts DATABASE_URL or the DB_* parts (see
 * database-url.ts). Running it again is a no-op (see packages/db/src/indexes.ts).
 *
 *   node apps/api/dist/cli/migrate.js
 */
import '../database-url';
import { PrismaClient, syncIndexes } from '@zapx/db';

const prisma = new PrismaClient();
syncIndexes(prisma)
  .then(async (n) => {
    process.stdout.write(`MongoDB collections and ${n} indexes are in place\n`);
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
