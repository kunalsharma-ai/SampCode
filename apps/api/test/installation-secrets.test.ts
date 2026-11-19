/**
 * ADR 0043: nobody generates JWT_SECRET or SIGNING_KEYS_SECRET. The first process to start makes them,
 * seals them with SECRETS_KEY (from the environment or SECRETS_KEY_FILE) and keeps them in MongoDB;
 * every later start reads the same values. An environment value still wins.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type InstallationSecret } from '@zapx/db';
import { loadInstallationSecrets } from '../src/platform/installation-secrets';

const KEY = 'secrets-key-for-tests-0123456789abcdef0123';
const prisma = new PrismaClient();
let before: InstallationSecret | null = null;

beforeAll(async () => {
  // Keep the row a local server may already use, and put it back afterwards.
  before = await prisma.installationSecret.findUnique({ where: { id: 'installation' } });
  await prisma.installationSecret.deleteMany();
});

afterAll(async () => {
  await prisma.installationSecret.deleteMany();
  if (before) await prisma.installationSecret.create({ data: before });
  await prisma.$disconnect();
});

describe('installation secrets', () => {
  it('leaves values set in the environment alone and does not touch the database', async () => {
    const env = { JWT_SECRET: 'a'.repeat(40), SIGNING_KEYS_SECRET: 'b'.repeat(40) };
    const db = {
      installationSecret: new Proxy({}, { get: () => () => Promise.reject(new Error('no database call expected')) }),
    } as never;
    expect(await loadInstallationSecrets(env, db)).toEqual([]);
    expect(env.JWT_SECRET).toBe('a'.repeat(40));
  });

  it('needs SECRETS_KEY to make them', async () => {
    await expect(loadInstallationSecrets({}, prisma)).rejects.toThrow(/SECRETS_KEY is not set/);
  });

  it('makes them on the first start, sealed, and reads the same ones afterwards', async () => {
    const first: NodeJS.ProcessEnv = { SECRETS_KEY: KEY };
    expect(await loadInstallationSecrets(first, prisma)).toEqual(['JWT_SECRET', 'SIGNING_KEYS_SECRET']);
    expect(first.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(first.SIGNING_KEYS_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(first.JWT_SECRET).not.toBe(first.SIGNING_KEYS_SECRET);

    const row = await prisma.installationSecret.findUniqueOrThrow({ where: { id: 'installation' } });
    expect(row.sealed).toMatch(/^v1\./);
    expect(row.sealed).not.toContain(first.JWT_SECRET!);

    // A second process (the worker, a restart) gets the same values.
    const second: NodeJS.ProcessEnv = { SECRETS_KEY: KEY };
    await loadInstallationSecrets(second, prisma);
    expect(second).toMatchObject({ JWT_SECRET: first.JWT_SECRET, SIGNING_KEYS_SECRET: first.SIGNING_KEYS_SECRET });

    // Only the missing one is filled in.
    const partial: NodeJS.ProcessEnv = { SECRETS_KEY: KEY, JWT_SECRET: 'c'.repeat(40) };
    expect(await loadInstallationSecrets(partial, prisma)).toEqual(['SIGNING_KEYS_SECRET']);
    expect(partial.JWT_SECRET).toBe('c'.repeat(40));
  });

  it('reads SECRETS_KEY from SECRETS_KEY_FILE', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sampcode-key-')), 'secrets_key');
    writeFileSync(file, `${KEY}\n`);
    const env: NodeJS.ProcessEnv = { SECRETS_KEY_FILE: file };
    await loadInstallationSecrets(env, prisma);
    expect(env.SECRETS_KEY).toBe(KEY);
    expect(env.JWT_SECRET).toMatch(/^[0-9a-f]{64}$/);
    await expect(loadInstallationSecrets({ SECRETS_KEY_FILE: join(file, 'missing') }, prisma)).rejects.toThrow(/cannot be read/);
  });

  it('refuses to start with a different SECRETS_KEY', async () => {
    await expect(loadInstallationSecrets({ SECRETS_KEY: 'another-key-0123456789abcdef0123456789' }, prisma)).rejects.toThrow(
      /cannot be opened with this SECRETS_KEY/,
    );
  });
});
