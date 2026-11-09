import { NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { type PlanService } from '../plans/plan.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';

import { generateScimToken } from './scim-token';

/** Admins create, rotate and revoke the organization's SCIM token, and read the plan and usage. */
export class ScimAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
  ) {}

  plan(user: AuthUser) {
    return this.plans.summary(user.tenantId);
  }

  async status(user: AuthUser) {
    const [row, plan] = await Promise.all([
      this.prisma.tenantScim.findUnique({ where: { tenantId: user.tenantId } }),
      this.plans.plan(user.tenantId),
    ]);
    return {
      available: plan.limits.scim,
      baseUrl: `${config().STUDIO_URL.replace(/\/$/, '')}/api/scim/v2`,
      token: row ? { prefix: row.prefix, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt } : null,
    };
  }

  /** Creates the token, or replaces the current one (which stops working at once). Shown once. */
  async create(user: AuthUser) {
    await this.plans.assertFeature(user.tenantId, 'scim');
    const t = generateScimToken();
    const data = { prefix: t.prefix, secretHash: t.secretHash, createdById: user.id, createdAt: new Date(), lastUsedAt: null };
    const before = await this.prisma.tenantScim.findUnique({ where: { tenantId: user.tenantId } });
    await this.prisma.tenantScim.upsert({ where: { tenantId: user.tenantId }, create: { tenantId: user.tenantId, ...data }, update: data });
    await this.audit.record(user, before ? 'scim.token_rotate' : 'scim.token_create', 'tenant', user.tenantId, { prefix: t.prefix });
    return { token: t.token, prefix: t.prefix };
  }

  async revoke(user: AuthUser) {
    const row = await this.prisma.tenantScim.findUnique({ where: { tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('There is no SCIM token');
    await this.prisma.tenantScim.delete({ where: { tenantId: user.tenantId } });
    await this.audit.record(user, 'scim.token_revoke', 'tenant', user.tenantId, { prefix: row.prefix });
  }
}

/** Express routes of ScimAdminController (mounted by src/http/app.ts). */
export function scimAdminControllerRoutes(r: Router, c: ScimAdminController, kit: RouteKit) {
  r.get(
    '/api/plan',
    ...kit.route({ controller: 'ScimAdminController', handler: 'plan', method: 'get', roles: ['ADMIN', 'PROGRAMMER', 'VIEWER'] }, (req) =>
      c.plan(req.user as AuthUser),
    ),
  );
  r.get(
    '/api/scim/token',
    ...kit.route({ controller: 'ScimAdminController', handler: 'status', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.status(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/scim/token',
    ...kit.route({ controller: 'ScimAdminController', handler: 'create', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.create(req.user as AuthUser),
    ),
  );
  r.delete(
    '/api/scim/token',
    ...kit.route({ controller: 'ScimAdminController', handler: 'revoke', method: 'delete', status: 204, roles: ['ADMIN'] }, (req) =>
      c.revoke(req.user as AuthUser),
    ),
  );
}
