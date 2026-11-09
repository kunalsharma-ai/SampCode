/**
 * `pnpm db:migrate`: creates the MongoDB collections and makes their indexes match schema.prisma
 * (see indexes.ts). Safe to run on every release; it only touches indexes Prisma names (…_key, …_idx).
 *   DATABASE_URL=mongodb://… node packages/db/dist/sync-indexes.js
 */
import { PrismaClient } from './client';
import { collections, indexSpecs, type IndexSpec } from './indexes';

type ExistingIndex = { name: string; key: Record<string, number>; unique?: boolean; partialFilterExpression?: unknown };

const same = (a: ExistingIndex, b: IndexSpec) =>
  JSON.stringify(a.key) === JSON.stringify(b.keys) &&
  !!a.unique === b.unique &&
  JSON.stringify(a.partialFilterExpression ?? null) === JSON.stringify(b.partialFilterExpression ?? null);

// eslint-disable-next-line no-console -- an operator command prints its progress
const print = (line: string) => console.log(line);

export async function syncIndexes(prisma: PrismaClient, log: (line: string) => void = print) {
  const specs = indexSpecs();
  const existingCollections = new Set(
    (
      (await prisma.$runCommandRaw({ listCollections: 1, nameOnly: true })) as { cursor: { firstBatch: Array<{ name: string }> } }
    ).cursor.firstBatch.map((c) => c.name),
  );
  let created = 0;
  let dropped = 0;
  for (const name of collections()) {
    if (!existingCollections.has(name)) {
      await prisma.$runCommandRaw({ create: name });
      log(`+ collection ${name}`);
    }
    const listed = (await prisma.$runCommandRaw({ listIndexes: name })) as { cursor: { firstBatch: ExistingIndex[] } };
    const existing = new Map(listed.cursor.firstBatch.map((i) => [i.name, i]));
    const wanted = specs.filter((s) => s.collection === name);
    for (const [indexName, index] of existing) {
      const spec = wanted.find((w) => w.name === indexName);
      if (indexName === '_id_' || (spec && same(index, spec))) continue;
      if (!spec && !/_(key|idx)$/.test(indexName)) continue; // not ours
      await prisma.$runCommandRaw({ dropIndexes: name, index: indexName });
      existing.delete(indexName);
      dropped++;
      log(`- index ${indexName}`);
    }
    const missing = wanted.filter((w) => !existing.has(w.name));
    if (!missing.length) continue;
    await prisma.$runCommandRaw({
      createIndexes: name,
      indexes: missing.map((s) => ({
        name: s.name,
        key: s.keys,
        ...(s.unique ? { unique: true } : {}),
        ...(s.partialFilterExpression ? { partialFilterExpression: s.partialFilterExpression } : {}),
      })),
    } as never);
    for (const s of missing) log(`+ index ${s.name}`);
    created += missing.length;
  }
  log(`Indexes in sync (${specs.length} declared, ${created} created, ${dropped} dropped).`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  syncIndexes(prisma)
    .catch((e: Error) => {
      console.error(`Could not sync the MongoDB indexes: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
