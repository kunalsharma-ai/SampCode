/**
 * Tests set provider keys the way a person does: saved (sealed) in the database, as Settings >
 * Integrations would, then every in-process copy is refreshed. There is no environment fallback
 * (ADR 0043). Tests share one database, so a file that saves integrations removes them in afterAll.
 */
import type { PrismaService } from '../../src/common/prisma.service';
import type { AuditService } from '../../src/common/audit.service';
import { IntegrationSettingsService } from '../../src/platform/integration-settings.service';
import { INTEGRATIONS, type IntegrationKey } from '../../src/platform/integrations';
import { LocalSecretBox } from '../../src/platform/secret-box';

const refresh = (prisma: PrismaService) => new IntegrationSettingsService(prisma, {} as AuditService).refresh();

export async function saveIntegration(prisma: PrismaService, key: IntegrationKey, values: Record<string, string>, enabled = true) {
  const def = INTEGRATIONS[key];
  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const [name, v] of Object.entries(values)) {
    const f = def.fields.find((x) => x.name === name);
    if (!f) throw new Error(`${key} has no field ${name}`);
    (f.secret ? secrets : settings)[name] = v;
  }
  const data = {
    enabled,
    settings,
    secretsSealed: Object.keys(secrets).length ? new LocalSecretBox().seal(JSON.stringify(secrets)) : null,
    updatedById: null,
  };
  await prisma.platformIntegration.upsert({ where: { key }, create: { key, ...data }, update: data });
  await refresh(prisma);
}

/** Remove saved integrations (all of them when no keys are given). */
export async function clearIntegrations(prisma: PrismaService, ...keys: IntegrationKey[]) {
  await prisma.platformIntegration.deleteMany(keys.length ? { where: { key: { in: keys } } } : undefined);
  await refresh(prisma);
}
