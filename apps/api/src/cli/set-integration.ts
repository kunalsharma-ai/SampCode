/**
 * Operator command: save a platform integration in the database, exactly as Settings > Integrations
 * does (ADR 0043), for scripted installs and tests. Values are checked like in the CRM, secrets are
 * sealed with SECRETS_KEY, and the running API and worker pick the change up within seconds.
 *
 *   node apps/api/dist/cli/set-integration.js <key> '<json values>' [--off]
 *   echo '{"apiKey":"..."}' | node apps/api/dist/cli/set-integration.js deepgram -     (keeps keys out of shell history)
 *   node apps/api/dist/cli/set-integration.js <key> --remove
 *
 * Keys: anthropic, ipinfo, deepgram, twilio, sendgrid, stripe, s3, sampleon, cdn. The field names are
 * the ones in apps/api/src/platform/integrations.ts (for example deepgram: apiKey, model).
 */
import '../database-url';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@zapx/db';
import { INTEGRATIONS, INTEGRATION_KEYS, isIntegrationKey } from '../platform/integrations';
import { LocalSecretBox } from '../platform/secret-box';

function masterKey(): string {
  const env = process.env;
  if (env.SECRETS_KEY) return env.SECRETS_KEY;
  if (env.SECRETS_KEY_FILE) return readFileSync(env.SECRETS_KEY_FILE, 'utf8').trim();
  // Development without SECRETS_KEY seals with JWT_SECRET, as the API does.
  if (env.JWT_SECRET && env.NODE_ENV !== 'production') return env.JWT_SECRET;
  throw new Error('SECRETS_KEY (or SECRETS_KEY_FILE) is not set');
}

async function main() {
  const [key, arg, flag] = process.argv.slice(2);
  if (!key || !isIntegrationKey(key) || !arg) {
    console.error(`Usage: set-integration <${INTEGRATION_KEYS.join('|')}> '<json values>'|- [--off]   or   set-integration <key> --remove`);
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    if (arg === '--remove') {
      await prisma.platformIntegration.deleteMany({ where: { key } });
      process.stdout.write(`${key} removed\n`);
      return;
    }
    const raw = arg === '-' ? readFileSync(0, 'utf8') : arg;
    const values = JSON.parse(raw) as Record<string, unknown>;
    const def = INTEGRATIONS[key];
    const settings: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const [name, v] of Object.entries(values)) {
      const f = def.fields.find((x) => x.name === name);
      if (!f) throw new Error(`${def.name} has no field "${name}" (fields: ${def.fields.map((x) => x.name).join(', ')})`);
      const text = String(v).trim();
      const problem = f.check?.(text);
      if (problem) throw new Error(`${f.label} ${problem}`);
      if (text) (f.secret ? secrets : settings)[name] = text;
    }
    const enabled = flag !== '--off';
    if (enabled) {
      const missing = def.fields.filter((f) => f.required && !settings[f.name] && !secrets[f.name]);
      if (missing.length) throw new Error(`Fill in ${missing.map((f) => f.name).join(', ')} before turning ${def.name} on`);
      const problem = def.validate?.({ ...settings, ...secrets });
      if (problem) throw new Error(`${def.name} ${problem}`);
    }
    const data = {
      enabled,
      settings,
      secretsSealed: Object.keys(secrets).length ? new LocalSecretBox(masterKey()).seal(JSON.stringify(secrets)) : null,
      updatedById: null,
    };
    await prisma.platformIntegration.upsert({ where: { key }, create: { key, ...data }, update: data });
    process.stdout.write(`${def.name} saved (${enabled ? 'on' : 'off'})\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
