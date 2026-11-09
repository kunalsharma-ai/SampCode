import { ForbiddenException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Prisma } from '@zapx/db';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { type AccessService } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { layerSchema, readLayer } from './integration-config';
import { type RedirectRepository } from './redirect.repository';
import { type CallbackWorker } from './callback.worker';

/** Studio endpoints of the integration module: delivery log, replay, redirect log and defaults. */
export class IntegrationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly repo: RedirectRepository,
    private readonly worker: CallbackWorker,
    private readonly access: AccessService,
  ) {}

  private async vendor(user: AuthUser, id: string) {
    const v = await this.prisma.vendor.findFirst({ where: { id, ...this.access.vendors(user) } });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  async callbacks(user: AuthUser, id: string) {
    await this.vendor(user, id);
    const [items, counts] = await Promise.all([this.repo.listCallbacks(user.tenantId, id), this.repo.callbackCounts(user.tenantId, id)]);
    return { items, counts: Object.fromEntries(counts.map((c) => [c.state, c._count._all])) };
  }

  async replay(user: AuthUser, id: string) {
    const cb = await this.repo.findCallback(user.tenantId, id);
    if (!cb) throw new NotFoundException('Callback not found');
    const vendor = await this.vendor(user, cb.vendorId);
    const updated = await this.repo.replay(cb.id, vendor.callbackMaxAttempts);
    await this.audit.record(user, 'callback.replay', 'vendor', vendor.id, {
      callbackId: cb.id,
      previousState: cb.state,
      attempts: cb.attempts,
    });
    void this.worker.runOnce().catch(() => undefined);
    return updated;
  }

  async events(user: AuthUser, id: string) {
    await this.vendor(user, id);
    return this.repo.listRedirectEvents(user.tenantId, id);
  }

  // ---- Redirect defaults: project and organization levels -------------------------------------

  async projectDefaults(user: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
    if (!p) throw new NotFoundException('Project not found');
    return readLayer(p.redirectDefaults);
  }

  async saveProjectDefaults(user: AuthUser, id: string, body: unknown) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
    if (!p) throw new NotFoundException('Project not found');
    const layer = parseBody(layerSchema, body);
    await this.prisma.project.update({ where: { id }, data: { redirectDefaults: layer as Prisma.InputJsonValue } });
    await this.audit.record(user, 'project.redirect_defaults', 'project', id, { before: p.redirectDefaults, after: layer });
    return layer;
  }

  async orgDefaults(user: AuthUser) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    return readLayer(t.redirectDefaults);
  }

  async saveOrgDefaults(user: AuthUser, body: unknown) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Only administrators can change organization defaults');
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    const layer = parseBody(layerSchema, body);
    await this.prisma.tenant.update({ where: { id: user.tenantId }, data: { redirectDefaults: layer as Prisma.InputJsonValue } });
    await this.audit.record(user, 'organization.redirect_defaults', 'tenant', user.tenantId, { before: t.redirectDefaults, after: layer });
    return layer;
  }
}

/** Express routes of IntegrationsController (mounted by src/http/app.ts). */
export function integrationsControllerRoutes(r: Router, c: IntegrationsController, kit: RouteKit) {
  r.get(
    '/api/vendors/:id/callbacks',
    ...kit.route({ controller: 'IntegrationsController', handler: 'callbacks', method: 'get' }, (req) =>
      c.callbacks(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/callbacks/:id/replay',
    ...kit.route({ controller: 'IntegrationsController', handler: 'replay', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.replay(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/vendors/:id/redirect-events',
    ...kit.route({ controller: 'IntegrationsController', handler: 'events', method: 'get' }, (req) =>
      c.events(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/projects/:id/redirect-defaults',
    ...kit.route({ controller: 'IntegrationsController', handler: 'projectDefaults', method: 'get' }, (req) =>
      c.projectDefaults(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/projects/:id/redirect-defaults',
    ...kit.route({ controller: 'IntegrationsController', handler: 'saveProjectDefaults', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.saveProjectDefaults(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/organization/redirect-defaults',
    ...kit.route({ controller: 'IntegrationsController', handler: 'orgDefaults', method: 'get' }, (req) =>
      c.orgDefaults(req.user as AuthUser),
    ),
  );
  r.put(
    '/api/organization/redirect-defaults',
    ...kit.route({ controller: 'IntegrationsController', handler: 'saveOrgDefaults', method: 'put' }, (req) =>
      c.saveOrgDefaults(req.user as AuthUser, req.body),
    ),
  );
}
