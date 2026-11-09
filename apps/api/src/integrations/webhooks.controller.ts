import { NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { config } from '../config';
import { type SecretBox } from '../platform/secret-box';
import type { AuthUser } from '../auth/auth.types';

import { newWebhookSecret } from './webhook-signing';
import { WEBHOOK_EVENTS, type WebhookService } from './webhook.service';

const url = z
  .string()
  .trim()
  .url()
  .max(2000)
  .refine((u) => {
    const p = new URL(u).protocol;
    return p === 'https:' || (p === 'http:' && config().CALLBACK_ALLOW_PRIVATE_HOSTS);
  }, 'Use an https:// address');

const createSchema = z.object({
  url,
  description: z.string().trim().max(200).optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});
const updateSchema = z.object({
  url: url.optional(),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  active: z.boolean().optional(),
});

const SELECT = { id: true, url: true, description: true, events: true, active: true, createdAt: true, updatedAt: true } as const;

/** Outbound webhooks for the organization (Milestone 6). Admins only; see docs/modules/webhooks.md. */
export class WebhooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly box: SecretBox,
    private readonly webhooks: WebhookService,
  ) {}

  private async own(user: AuthUser, id: string) {
    const w = await this.prisma.webhook.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!w) throw new NotFoundException('Webhook not found');
    return w;
  }

  events() {
    return WEBHOOK_EVENTS;
  }

  async list(user: AuthUser) {
    const [hooks, counts] = await Promise.all([
      this.prisma.webhook.findMany({ where: { tenantId: user.tenantId }, select: SELECT, orderBy: { createdAt: 'asc' } }),
      this.prisma.webhookDelivery.groupBy({ by: ['webhookId', 'state'], where: { tenantId: user.tenantId }, _count: { _all: true } }),
    ]);
    return hooks.map((h) => ({
      ...h,
      counts: Object.fromEntries(counts.filter((c) => c.webhookId === h.id).map((c) => [c.state, c._count._all])),
    }));
  }

  async create(user: AuthUser, body: unknown) {
    const input = parseBody(createSchema, body);
    const secret = newWebhookSecret();
    const hook = await this.prisma.webhook.create({
      data: {
        tenantId: user.tenantId,
        url: input.url,
        description: input.description ?? null,
        events: input.events,
        secretEnc: this.box.seal(secret),
        createdById: user.id,
      },
      select: SELECT,
    });
    await this.audit.record(user, 'webhook.create', 'webhook', hook.id, { url: hook.url, events: hook.events });
    // The signing secret is shown once; rotate it to get a new one.
    return { ...hook, secret };
  }

  async update(user: AuthUser, id: string, body: unknown) {
    const before = await this.own(user, id);
    const input = parseBody(updateSchema, body);
    const hook = await this.prisma.webhook.update({ where: { id }, data: input, select: SELECT });
    await this.audit.record(user, 'webhook.update', 'webhook', id, {
      before: { url: before.url, events: before.events, active: before.active },
      after: { url: hook.url, events: hook.events, active: hook.active },
    });
    return hook;
  }

  async rotate(user: AuthUser, id: string) {
    await this.own(user, id);
    const secret = newWebhookSecret();
    await this.prisma.webhook.update({ where: { id }, data: { secretEnc: this.box.seal(secret) } });
    await this.audit.record(user, 'webhook.rotate_secret', 'webhook', id);
    return { secret };
  }

  async remove(user: AuthUser, id: string) {
    const w = await this.own(user, id);
    await this.prisma.webhook.delete({ where: { id } });
    await this.audit.record(user, 'webhook.delete', 'webhook', id, { url: w.url });
  }

  async test(user: AuthUser, id: string) {
    await this.own(user, id);
    const d = await this.webhooks.test(user.tenantId, id);
    void this.webhooks.deliverDue().catch(() => undefined);
    return { deliveryId: d.id };
  }

  async deliveries(user: AuthUser, id: string) {
    await this.own(user, id);
    return this.prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        event: true,
        state: true,
        attempts: true,
        lastHttpStatus: true,
        lastError: true,
        nextAttemptAt: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }

  async redeliver(user: AuthUser, id: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!d) throw new NotFoundException('Delivery not found');
    const updated = await this.prisma.webhookDelivery.update({
      where: { id },
      data: { state: 'PENDING', nextAttemptAt: new Date(), attempts: 0, lastError: null },
      select: { id: true, state: true },
    });
    await this.audit.record(user, 'webhook.redeliver', 'webhook', d.webhookId, { deliveryId: id, previousState: d.state });
    void this.webhooks.deliverDue().catch(() => undefined);
    return updated;
  }
}

/** Express routes of WebhooksController (mounted by src/http/app.ts). */
export function webhooksControllerRoutes(r: Router, c: WebhooksController, kit: RouteKit) {
  r.get(
    '/api/webhook-events',
    ...kit.route({ controller: 'WebhooksController', handler: 'events', method: 'get', roles: ['ADMIN'] }, () => c.events()),
  );
  r.get(
    '/api/webhooks',
    ...kit.route({ controller: 'WebhooksController', handler: 'list', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.list(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/webhooks',
    ...kit.route({ controller: 'WebhooksController', handler: 'create', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.create(req.user as AuthUser, req.body),
    ),
  );
  r.patch(
    '/api/webhooks/:id',
    ...kit.route({ controller: 'WebhooksController', handler: 'update', method: 'patch', roles: ['ADMIN'] }, (req) =>
      c.update(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/webhooks/:id/rotate-secret',
    ...kit.route({ controller: 'WebhooksController', handler: 'rotate', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.rotate(req.user as AuthUser, req.params.id),
    ),
  );
  r.delete(
    '/api/webhooks/:id',
    ...kit.route({ controller: 'WebhooksController', handler: 'remove', method: 'delete', status: 204, roles: ['ADMIN'] }, (req) =>
      c.remove(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/webhooks/:id/test',
    ...kit.route({ controller: 'WebhooksController', handler: 'test', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.test(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/webhooks/:id/deliveries',
    ...kit.route({ controller: 'WebhooksController', handler: 'deliveries', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.deliveries(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/webhook-deliveries/:id/redeliver',
    ...kit.route({ controller: 'WebhooksController', handler: 'redeliver', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.redeliver(req.user as AuthUser, req.params.id),
    ),
  );
}
