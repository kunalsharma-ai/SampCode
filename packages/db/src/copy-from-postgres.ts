/**
 * One-off copy of an existing SampCode PostgreSQL database into MongoDB (ADR 0040). Reads every table
 * of the old schema (one per Prisma model, same column names) and writes the rows through Prisma, so
 * types (dates, enums, JSON, BigInt, arrays) come out exactly as the app writes them. Ids are kept.
 *
 *   POSTGRES_URL=postgresql://user:pass@host:5432/zapx \
 *   DATABASE_URL=mongodb://host:27017/zapx?replicaSet=rs0 \
 *   node packages/db/dist/copy-from-postgres.js [--only Model,Model] [--allow-non-empty]
 *
 * Run `pnpm db:migrate` against the MongoDB database first (collections and indexes). Stop the API and
 * worker during the copy. The target collections must be empty unless --allow-non-empty is given; the
 * script compares row counts at the end and exits non-zero on any difference.
 */
import { Client } from 'pg';
import { Prisma, PrismaClient } from './index';

type Field = (typeof Prisma.dmmf.datamodel.models)[number]['fields'][number];
const BATCH = 1000;

function convert(fields: readonly Field[], row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.kind === 'object') continue;
    const v = row[f.name];
    if (v === undefined) continue; // a column the old database did not have yet: the schema default applies
    if (v === null) {
      if (!f.isRequired) out[f.name] = null;
      continue;
    }
    if (f.type === 'BigInt') out[f.name] = BigInt(v as string | number);
    else if (f.type === 'Json') out[f.name] = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
    else if (f.type === 'Float') out[f.name] = Number(v);
    else out[f.name] = v;
  }
  return out;
}

async function main() {
  const pgUrl = process.env.POSTGRES_URL;
  if (!pgUrl) throw new Error('Set POSTGRES_URL to the old PostgreSQL database');
  if (!process.env.DATABASE_URL?.startsWith('mongodb')) throw new Error('Set DATABASE_URL to the MongoDB database');
  const args = process.argv.slice(2);
  const only = args.includes('--only') ? new Set((args[args.indexOf('--only') + 1] ?? '').split(',')) : null;
  const allowNonEmpty = args.includes('--allow-non-empty');

  const pg = new Client({ connectionString: pgUrl.replace(/[?&](connection_limit|pool_timeout|schema)=[^&]*/g, '') });
  await pg.connect();
  const prisma = new PrismaClient();
  const tables = new Set(
    (await pg.query<{ t: string }>(`SELECT tablename AS t FROM pg_tables WHERE schemaname = current_schema()`)).rows.map((r) => r.t),
  );
  const mismatches: string[] = [];
  try {
    for (const model of Prisma.dmmf.datamodel.models) {
      if (only && !only.has(model.name)) continue;
      if (!tables.has(model.name)) {
        console.warn(`- ${model.name}: no such table in PostgreSQL, skipped`);
        continue;
      }
      const delegate = (
        prisma as unknown as Record<string, { count(): Promise<number>; createMany(a: { data: unknown[] }): Promise<{ count: number }> }>
      )[model.name.charAt(0).toLowerCase() + model.name.slice(1)]!;
      if (!allowNonEmpty && (await delegate.count()) > 0)
        throw new Error(`${model.name} already has documents in MongoDB (use --allow-non-empty to add anyway)`);
      const total = Number((await pg.query<{ n: string }>(`SELECT count(*) AS n FROM "${model.name}"`)).rows[0]?.n ?? 0);
      // A stable order so batches never skip or repeat rows: the primary key, or the physical row order
      // for the two tables whose old key was composite (nothing writes while the copy runs).
      const columns = new Set(
        (
          await pg.query<{ c: string }>(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = $1`, [model.name])
        ).rows.map((r) => r.c),
      );
      const idColumn = model.fields.find((f) => f.isId)?.name;
      const order = idColumn && columns.has(idColumn) ? `"${idColumn}"` : 'ctid';
      let copied = 0;
      for (let offset = 0; offset < total; offset += BATCH) {
        const { rows } = await pg.query<Record<string, unknown>>(
          `SELECT * FROM "${model.name}" ORDER BY ${order} LIMIT ${BATCH} OFFSET ${offset}`,
        );
        if (!rows.length) break;
        copied += (await delegate.createMany({ data: rows.map((r) => convert(model.fields, r)) })).count;
      }
      const inMongo = await delegate.count();
      console.warn(`${inMongo === total || allowNonEmpty ? '✓' : '✗'} ${model.name}: ${copied} of ${total} rows copied`);
      if (copied !== total) mismatches.push(`${model.name} (${copied} of ${total})`);
    }
  } finally {
    await pg.end();
    await prisma.$disconnect();
  }
  if (mismatches.length) throw new Error(`Row counts differ: ${mismatches.join(', ')}`);
  console.warn('Copy finished. Start the API and check a few surveys before switching traffic.');
}

main().catch((e: Error) => {
  console.error(`Copy failed: ${e.message}`);
  process.exitCode = 1;
});
