/**
 * MongoDB keeps "no value" two ways: a field that is null, and a field that is missing. Prisma leaves
 * optional fields out of the documents it creates, but a Prisma filter `{ field: null }` only matches
 * an explicit null. Code written for PostgreSQL (where both are NULL) expects it to match both, so this
 * middleware rewrites every `field: null` / `field: { equals: null }` filter on an optional field into
 * `null OR not set`, and makes `lt` / `lte` on an optional field skip nulls (MongoDB sorts null first),
 * including filters nested in AND/OR/NOT, relation filters (some/every/none/is/isNot)
 * and the `where` of an include, select or _count.
 */
import { Prisma } from '@prisma/client';

type Field = (typeof Prisma.dmmf.datamodel.models)[number]['fields'][number];
type ModelInfo = { fields: Map<string, Field> };
type Where = Record<string, unknown>;

const models = new Map<string, ModelInfo>(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, { fields: new Map(m.fields.map((f) => [f.name, f])) }]),
);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

const missingOrNull = (name: string): Where => ({ OR: [{ [name]: null }, { [name]: { isSet: false } }] });

/** The `where` with null-equality filters widened to "null or not set". Returns a new object. */
export function widenNullFilters(model: string, where: unknown): unknown {
  const info = models.get(model);
  if (!info || !isPlainObject(where)) return where;
  const out: Where = {};
  const extra: Where[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      out[key] = Array.isArray(value) ? value.map((w) => widenNullFilters(model, w)) : widenNullFilters(model, value);
      continue;
    }
    const field = info.fields.get(key);
    if (!field) {
      // A compound unique key (projectId_userId) or an unknown key: leave it to Prisma.
      out[key] = value;
      continue;
    }
    if (field.kind === 'object') {
      out[key] = widenRelationFilter(field, value);
      continue;
    }
    const optionalScalar = !field.isRequired && !field.isList;
    if (optionalScalar && value === null) {
      extra.push(missingOrNull(key));
      continue;
    }
    if (optionalScalar && isPlainObject(value) && 'equals' in value && value.equals === null) {
      const { equals: _ignored, ...rest } = value;
      extra.push(missingOrNull(key));
      if (Object.keys(rest).length) out[key] = rest;
      continue;
    }
    // MongoDB orders null before every value, so `lt` / `lte` would match an explicit null. SQL never
    // matches NULL with a comparison: exclude null (and unset) values.
    if (optionalScalar && isPlainObject(value) && ('lt' in value || 'lte' in value)) {
      out[key] = value;
      extra.push({ [key]: { not: null } });
      continue;
    }
    out[key] = value;
  }
  if (extra.length) {
    const and = out.AND === undefined ? [] : Array.isArray(out.AND) ? out.AND : [out.AND];
    out.AND = [...and, ...extra];
  }
  return out;
}

function widenRelationFilter(field: Field, value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  const target = field.type;
  const ops = ['some', 'every', 'none', 'is', 'isNot'];
  if (Object.keys(value).some((k) => ops.includes(k))) {
    const out: Where = {};
    for (const [k, v] of Object.entries(value)) out[k] = ops.includes(k) ? widenNullFilters(target, v) : v;
    return out;
  }
  // To-one shorthand: `relation: { field: value }`.
  return widenNullFilters(target, value);
}

/** Widens the `where` of nested include/select (and _count) blocks. */
function widenSelection(model: string, selection: unknown): unknown {
  const info = models.get(model);
  if (!info || !isPlainObject(selection)) return selection;
  const out: Where = {};
  for (const [key, value] of Object.entries(selection)) {
    if (key === '_count' && isPlainObject(value) && isPlainObject(value.select)) {
      const select: Where = {};
      for (const [rel, v] of Object.entries(value.select)) {
        const f = info.fields.get(rel);
        select[rel] = f?.kind === 'object' && isPlainObject(v) ? widenArgs(f.type, v) : v;
      }
      out[key] = { ...value, select };
      continue;
    }
    const field = info.fields.get(key);
    out[key] = field?.kind === 'object' && isPlainObject(value) ? widenArgs(field.type, value) : value;
  }
  return out;
}

/** Rewrites the arguments of one Prisma operation on `model`. */
export function widenArgs(model: string, args: unknown): Record<string, unknown> {
  if (!isPlainObject(args)) return args as Record<string, unknown>;
  const out: Record<string, unknown> = { ...args };
  if ('where' in out) out.where = widenNullFilters(model, out.where);
  if ('include' in out) out.include = widenSelection(model, out.include);
  if ('select' in out) out.select = widenSelection(model, out.select);
  return out;
}

export const nullFilterMiddleware: Prisma.Middleware = (params, next) => {
  if (params.model && params.args) params.args = widenArgs(params.model, params.args);
  return next(params);
};
