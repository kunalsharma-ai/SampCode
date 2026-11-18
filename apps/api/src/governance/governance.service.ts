import { BadRequestException } from '../http/errors';
import { Logger } from '../http/logger';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { integration } from '../platform/integrations';
import type { AuthUser } from '../auth/auth.types';
import { config } from '../config';
import { type CaptureService } from '../captures/capture.service';

const days = z.number().int().min(1).max(3650).nullable().optional();
export const retentionSchema = z.object({ responsesDays: days, capturesDays: days, contactsDays: days }).strict();
export type Retention = z.infer<typeof retentionSchema>;

export const governanceSchema = z
  .object({
    dataRegion: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]{2,20}$/, 'Use a short region code such as eu, us or in')
      .nullable()
      .optional(),
    blockExternalProcessors: z.boolean().optional(),
    retention: retentionSchema.optional(),
  })
  .strict();

const DAY_MS = 86_400_000;
const BATCH = 500;

export function readRetention(raw: unknown): Retention {
  const p = retentionSchema.safeParse(raw ?? {});
  return p.success ? p.data : {};
}

/** Services configured on this deployment that send organization data outside it. */
export function externalProcessors() {
  const twilio = integration('twilio');
  return [
    { id: 'ai', name: 'AI (Anthropic Claude)', on: integration('anthropic').enabled, blockable: true },
    { id: 'transcription', name: 'Transcription (Deepgram)', on: integration('deepgram').enabled, blockable: true },
    { id: 'network_reputation', name: 'Network reputation (IPinfo)', on: integration('ipinfo').enabled, blockable: true },
    { id: 'email', name: 'Email (SendGrid)', on: integration('sendgrid').enabled, blockable: false },
    { id: 'sms', name: 'SMS (Twilio)', on: twilio.enabled && !!twilio.values.smsFrom, blockable: false },
    { id: 'telephony', name: 'Phone dialer (Twilio)', on: twilio.enabled && !!twilio.values.callerId, blockable: false },
    { id: 'sampaudience', name: 'Audience (SampAudience)', on: integration('sampleon').enabled, blockable: false },
    {
      id: 'file_store',
      name: `File storage (S3${integration('s3').values.region ? `, ${integration('s3').values.region}` : ''})`,
      on: integration('s3').enabled,
      blockable: false,
    },
  ];
}

export class GovernanceService {
  private readonly log = new Logger('Retention');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly captures: CaptureService,
  ) {}

  async get(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { dataRegion: true, blockExternalProcessors: true, retention: true },
    });
    const deploymentRegion = config().DATA_REGION || null;
    return {
      deploymentRegion,
      dataRegion: t.dataRegion,
      regionMatches: !t.dataRegion || !deploymentRegion ? null : t.dataRegion === deploymentRegion,
      blockExternalProcessors: t.blockExternalProcessors,
      processors: externalProcessors(),
      retention: readRetention(t.retention),
      captureRetentionDays: config().CAPTURE_RETENTION_DAYS || null,
    };
  }

  async update(user: AuthUser, body: unknown) {
    const p = governanceSchema.safeParse(body);
    if (!p.success) throw new BadRequestException(p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    const before = await this.get(user.tenantId);
    const retention = p.data.retention
      ? Object.fromEntries(Object.entries({ ...before.retention, ...p.data.retention }).filter(([, v]) => v !== null && v !== undefined))
      : undefined;
    await this.prisma.tenant.update({
      where: { id: user.tenantId },
      data: {
        ...(p.data.dataRegion !== undefined ? { dataRegion: p.data.dataRegion } : {}),
        ...(p.data.blockExternalProcessors !== undefined ? { blockExternalProcessors: p.data.blockExternalProcessors } : {}),
        ...(retention ? { retention: retention as Prisma.InputJsonValue } : {}),
      },
    });
    const after = await this.get(user.tenantId);
    await this.audit.record(user, 'governance.update', 'tenant', user.tenantId, {
      before: { dataRegion: before.dataRegion, blockExternalProcessors: before.blockExternalProcessors, retention: before.retention },
      after: { dataRegion: after.dataRegion, blockExternalProcessors: after.blockExternalProcessors, retention: after.retention },
    });
    return after;
  }

  /** True when the organization refuses processors outside the deployment. */
  async blocksExternal(tenantId: string): Promise<boolean> {
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { blockExternalProcessors: true } });
    return !!t?.blockExternalProcessors;
  }

  /** Apply every organization's retention policy (worker housekeeping). */
  async applyRetention(now = new Date()) {
    const tenants = await this.prisma.tenant.findMany({
      where: { NOT: { retention: { equals: {} } } },
      select: { id: true, retention: true },
    });
    const total = { responses: 0, captures: 0, contacts: 0 };
    for (const t of tenants) {
      const r = readRetention(t.retention);
      const done = { responses: 0, captures: 0, contacts: 0 };
      if (r.responsesDays) done.responses = await this.eraseResponses(t.id, new Date(now.getTime() - r.responsesDays * DAY_MS));
      if (r.capturesDays)
        done.captures += await this.captures.dropWhere({ tenantId: t.id, before: new Date(now.getTime() - r.capturesDays * DAY_MS) });
      if (r.contactsDays) done.contacts = await this.eraseContacts(t.id, new Date(now.getTime() - r.contactsDays * DAY_MS));
      if (done.responses || done.captures || done.contacts) {
        await this.audit.record({ tenantId: t.id, id: null }, 'retention.apply', 'tenant', t.id, { ...done, policy: r });
        total.responses += done.responses;
        total.captures += done.captures;
        total.contacts += done.contacts;
      }
    }
    if (total.responses || total.captures || total.contacts) this.log.log(`Retention erased ${JSON.stringify(total)}`);
    return total;
  }

  /** Erase interviews started before the cutoff (in batches; the next pass continues). */
  private async eraseResponses(tenantId: string, before: Date): Promise<number> {
    let erased = 0;
    for (let round = 0; round < 10; round++) {
      const rows = await this.prisma.response.findMany({
        where: { tenantId, erasedAt: null, startedAt: { lt: before } },
        select: { id: true },
        take: BATCH,
      });
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      await this.captures.dropWhere({ tenantId, responseIds: ids });
      await this.prisma.openEndFingerprint.deleteMany({ where: { responseId: { in: ids } } });
      // Each row gets its own uid ('erased-' + id), so the rows are updated one by one.
      for (const id of ids)
        await this.prisma.response.updateMany({
          where: { id, erasedAt: null },
          data: {
            answers: {},
            entryParams: {},
            returnUrl: null,
            userAgent: null,
            ipHash: null,
            deviceHash: null,
            signals: {},
            location: null,
            evidence: null,
            geoCountry: null,
            uid: `erased-${id}`,
            erasedAt: new Date(),
          },
        });
      erased += ids.length;
    }
    return erased;
  }

  private async eraseContacts(tenantId: string, before: Date): Promise<number> {
    const n = await this.prisma.contact.updateMany({
      where: {
        tenantId,
        createdAt: { lt: before },
        unsubscribedAt: null,
        OR: [{ email: { not: null } }, { phone: { not: null } }, { name: { not: null } }],
      },
      data: { email: null, phone: null, name: null, fields: {} },
    });
    return n.count;
  }
}
