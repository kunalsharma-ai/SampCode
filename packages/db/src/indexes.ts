/**
 * MongoDB indexes for the Prisma schema. Replaces `prisma db push` and the old SQL migrations: it reads
 * every @unique, @@unique and @@index from schema.prisma and makes the collections match.
 *
 * Why not `prisma db push`: PostgreSQL lets a unique column hold many NULLs, MongoDB does not (a missing
 * field counts as null). So a unique index that covers an optional field is created here as a partial
 * index over documents where that field holds a value (`{ field: { $gt: '' } }`), which keeps PostgreSQL's
 * behaviour and still serves equality lookups. Prisma's push would recreate them as plain unique indexes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type IndexSpec = {
  collection: string;
  name: string;
  keys: Record<string, 1>;
  unique: boolean;
  partialFilterExpression?: Record<string, unknown>;
};

type ModelFields = Map<string, { optional: boolean; dbName: string }>;

export const schemaPath = () => resolve(__dirname, '../prisma/schema.prisma');

/** Every index the schema asks for, with Prisma's own index names. */
export function indexSpecs(schema = readFileSync(schemaPath(), 'utf8')): IndexSpec[] {
  const specs: IndexSpec[] = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (const match of schema.matchAll(modelRe)) {
    const model = match[1] ?? '';
    const body = match[2] ?? '';
    const collection = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model;
    const fields: ModelFields = new Map();
    const singleUniques: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.replace(/\/\/.*$/, '').trim();
      const m = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
      if (!m || line.startsWith('@@')) continue;
      const [, name = '', type = '', , optional, rest = ''] = m;
      if (isModel(schema, type)) continue; // a relation field, not stored
      const dbName = /@map\("([^"]+)"\)/.exec(rest)?.[1] ?? name;
      fields.set(name, { optional: !!optional, dbName });
      if (/@unique\b/.test(rest) && !/@id\b/.test(rest)) singleUniques.push(name);
    }
    const add = (names: string[], unique: boolean) => {
      const keys: Record<string, 1> = {};
      const optional: string[] = [];
      for (const n of names) {
        const f = fields.get(n);
        if (!f) throw new Error(`${model}: index field ${n} is not a scalar field`);
        keys[f.dbName] = 1;
        if (f.optional) optional.push(f.dbName);
      }
      const spec: IndexSpec = { collection, name: `${model}_${names.join('_')}_${unique ? 'key' : 'idx'}`, keys, unique };
      if (unique && optional.length) spec.partialFilterExpression = Object.fromEntries(optional.map((n) => [n, { $gt: '' }]));
      specs.push(spec);
    };
    for (const n of singleUniques) add([n], true);
    for (const [, kind, list = ''] of body.matchAll(/@@(unique|index)\(\[([^\]]+)\]/g))
      add(
        list.split(',').map((s) => s.trim()),
        kind === 'unique',
      );
  }
  return specs;
}

const isModel = (schema: string, type: string) => new RegExp(`^model\\s+${type}\\s*\\{`, 'm').test(schema);

/** Collection names of every model, so empty collections exist before the first transaction uses them. */
export function collections(schema = readFileSync(schemaPath(), 'utf8')): string[] {
  return [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(
    ([, model = '', body = '']) => /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model,
  );
}
