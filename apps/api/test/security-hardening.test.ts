/**
 * Security review findings S4 to S9 (docs/handbook/SECURITY_REVIEW.md): rate-limit counters shared
 * by every API process, separate signing keys, no session token in browser response bodies, the lint
 * security rules and row-level security on more personal-data tables. S6 (studio script nonce) is
 * covered by the milestone 20 browser test.
 */
import { vi } from 'vitest';

vi.hoisted(() => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.CALLBACK_WORKER = 'off';
  process.env.JOB_WORKER = 'off';
  process.env.SIGNUP_RATE_PER_MINUTE = '100';
  process.env.LOGIN_RATE_PER_MINUTE = '100';
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type ApiApp } from '../src/http/app';
import { DbThrottlerStorage, throttleStore } from '../src/common/db-throttler-storage';
import { PrismaService, TENANT_ISOLATED_MODELS } from '../src/common/prisma.service';
import { signingKey } from '../src/common/signing-keys';
import { config, resetConfig } from '../src/config';
import { testSignature } from '../src/interview/interview.service';

const run = `hard${Date.now().toString(36)}`;
const password = 'correct-horse-battery';
let app: ApiApp;
let http: ReturnType<typeof request>;
let prisma: PrismaService;

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    resetConfig();
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    resetConfig();
  }
}

beforeAll(async () => {
  resetConfig();
  app = createApp();
  await app.init();
  http = request(app.getHttpServer());
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: `test-${run}` } } });
  await app?.close();
});

describe('S4: shared rate-limit store', () => {
  it('is the database in production and memory elsewhere, unless THROTTLE_STORE says otherwise', () => {
    expect(withEnv({ NODE_ENV: 'test', THROTTLE_STORE: undefined }, throttleStore)).toBe('memory');
    expect(
      withEnv(
        {
          NODE_ENV: 'production',
          THROTTLE_STORE: undefined,
          JWT_SECRET: 'a'.repeat(48),
          SECRETS_KEY: 'b'.repeat(48),
          SIGNING_KEYS_SECRET: 'c'.repeat(48),
          COOKIE_SECURE: 'true',
        },
        throttleStore,
      ),
    ).toBe('database');
    expect(withEnv({ THROTTLE_STORE: 'database' }, throttleStore)).toBe('database');
  });

  it('counts hits from every process against one limit and blocks above it', async () => {
    // Two storages stand for two API tasks sharing the database.
    const a = new DbThrottlerStorage(prisma);
    const b = new DbThrottlerStorage(prisma);
    const key = `test-${run}-shared`;
    const hits = [];
    for (let i = 0; i < 3; i++) hits.push(await (i % 2 ? b : a).increment(key, 60_000, 3, 30_000, 'default'));
    expect(hits.map((h) => h.totalHits)).toEqual([1, 2, 3]);
    expect(hits.every((h) => !h.isBlocked)).toBe(true);
    expect(hits[0]!.timeToExpire).toBeGreaterThan(55);

    const fourth = await b.increment(key, 60_000, 3, 30_000, 'default');
    expect(fourth.isBlocked).toBe(true);
    expect(fourth.timeToBlockExpire).toBeGreaterThan(25);
    // While blocked, more hits are refused and not counted.
    const fifth = await a.increment(key, 60_000, 3, 30_000, 'default');
    expect(fifth).toMatchObject({ isBlocked: true, totalHits: 4 });
  });

  it('starts a new window once the old one ends, and sweeps finished counters', async () => {
    const s = new DbThrottlerStorage(prisma);
    const key = `test-${run}-window`;
    await s.increment(key, 60_000, 5, 60_000, 'default');
    await s.increment(key, 60_000, 5, 60_000, 'default');
    await prisma.rateLimitBucket.update({ where: { key: `default:${key}` }, data: { windowEnds: new Date(Date.now() - 120_000) } });
    expect((await s.increment(key, 60_000, 5, 60_000, 'default')).totalHits).toBe(1);

    await prisma.rateLimitBucket.update({ where: { key: `default:${key}` }, data: { windowEnds: new Date(Date.now() - 120_000) } });
    expect(await s.sweep()).toBeGreaterThanOrEqual(1);
    expect(await prisma.rateLimitBucket.count({ where: { key: `default:${key}` } })).toBe(0);
  });
});

describe('S5: signing keys separate from JWT_SECRET', () => {
  it('derives every key from JWT_SECRET as before while SIGNING_KEYS_SECRET is unset', () => {
    withEnv({ SIGNING_KEYS_SECRET: undefined }, () => {
      expect(signingKey('test-link', (legacy) => legacy)).toBe(config().JWT_SECRET);
    });
  });

  it('keeps test links valid when JWT_SECRET is rotated, once SIGNING_KEYS_SECRET is set', () => {
    const keys = 'k'.repeat(48);
    const before = withEnv({ SIGNING_KEYS_SECRET: keys, JWT_SECRET: 'j'.repeat(48) }, () => testSignature('s1', 'u1'));
    const after = withEnv({ SIGNING_KEYS_SECRET: keys, JWT_SECRET: 'r'.repeat(48) }, () => testSignature('s1', 'u1'));
    expect(after).toBe(before);
    // A different purpose never shares a key.
    withEnv({ SIGNING_KEYS_SECRET: keys }, () => {
      expect(
        Buffer.compare(
          signingKey('network-hash', () => Buffer.alloc(0)),
          signingKey('sso-state', () => Buffer.alloc(0)),
        ) !== 0,
      ).toBe(true);
    });
  });

  it('is required in production and must be its own value', () => {
    const prod = { NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(48), SECRETS_KEY: 'b'.repeat(48), COOKIE_SECURE: 'true' };
    expect(() => withEnv({ ...prod, SIGNING_KEYS_SECRET: undefined }, config)).toThrow(/SIGNING_KEYS_SECRET is required/);
    expect(() => withEnv({ ...prod, SIGNING_KEYS_SECRET: 'a'.repeat(48) }, config)).toThrow(/SIGNING_KEYS_SECRET: must be its own/);
    expect(withEnv({ ...prod, SIGNING_KEYS_SECRET: 'c'.repeat(48) }, () => config().SIGNING_KEYS_SECRET)).toBe('c'.repeat(48));
  });
});

describe('S7: session token in the response body', () => {
  const email = `s7-${run}@test.zapx`;

  it('is left out for browsers, which use the httpOnly cookie', async () => {
    const reg = await http
      .post('/api/auth/register')
      .set('Sec-Fetch-Mode', 'cors')
      .send({ organization: `S7 ${run}`, name: 'Sam', email, password })
      .expect(201);
    expect(reg.body.token).toBeUndefined();
    expect(String(reg.headers['set-cookie'])).toMatch(/httpOnly/i);

    const login = await http.post('/api/auth/login').set('Sec-Fetch-Mode', 'cors').send({ email, password }).expect(200);
    expect(login.body.token).toBeUndefined();
    expect(login.body.user.email).toBe(email);
  });

  it('is still returned to the mobile app and API scripts (no Sec-Fetch-Mode header)', async () => {
    const login = await http.post('/api/auth/login').set('X-ZAPX-Client', 'mobile').send({ email, password }).expect(200);
    expect(login.body.token).toEqual(expect.any(String));
    await http
      .get('/api/auth/me')
      .set({ Authorization: `Bearer ${login.body.token}` })
      .expect(200);
  });
});

describe('S8: static security rules in the lint', () => {
  it('runs eslint-plugin-security with every pnpm lint', () => {
    const cfg = readFileSync(join(__dirname, '../../../eslint.config.mjs'), 'utf8');
    expect(cfg).toContain("import security from 'eslint-plugin-security'");
    for (const rule of ['security/detect-eval-with-expression', 'security/detect-child-process', 'no-new-func'])
      expect(cfg).toContain(`'${rule}': 'error'`);
  });
});

describe('S9: tenant isolation on personal-data tables', () => {
  const tables = ['Response', 'Capture', 'CatiCase', 'CatiCall', 'DoNotCall', 'Contact', 'Invitation', 'BackCheck', 'QualityAppeal'];

  it('covers every listed table (PostgreSQL row-level security, now applied by forTenant)', () => {
    for (const t of tables) expect(TENANT_ISOLATED_MODELS.has(t), t).toBe(true);
    expect(prisma.rls).toBe('enforced');
  });

  it("hides another tenant's rows even without a tenant filter, and refuses writes for another tenant", async () => {
    const [mine, other] = [`t-${run}-a`, `t-${run}-b`];
    for (const [t, h] of [
      [mine, 'h1'],
      [other, 'h2'],
    ])
      await prisma.doNotCall.create({ data: { id: `${t}-${h}`, tenantId: t, phoneHash: `${run}-${h}`, hint: '123', source: 'manual' } });
    const db = prisma.forTenant(mine);
    const visible = await db.doNotCall.findMany({ where: { tenantId: { in: [mine, other] } } });
    expect(visible.map((r) => r.tenantId)).toEqual([mine]);
    expect(await db.doNotCall.findUnique({ where: { id: `${other}-h2` } })).toBeNull();
    expect(await db.doNotCall.count({ where: { phoneHash: `${run}-h2` } })).toBe(0);
    expect((await db.doNotCall.deleteMany({ where: { id: `${other}-h2` } })).count).toBe(0);
    await expect(db.doNotCall.create({ data: { tenantId: other, phoneHash: `${run}-h3`, hint: '123', source: 'manual' } })).rejects.toThrow(
      /another organization/,
    );
    expect(() => prisma.forTenant('')).toThrow();
    await prisma.doNotCall.deleteMany({ where: { tenantId: { in: [mine, other] } } });
  });
});
