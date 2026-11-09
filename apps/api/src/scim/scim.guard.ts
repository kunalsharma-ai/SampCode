import type { RequestGuard } from '../http/routes';
import type { Request } from 'express';
import { type PrismaService } from '../common/prisma.service';
import { type PlanService } from '../plans/plan.service';
import { secretMatches } from '../auth/api-keys';
import { parseScimToken } from './scim-token';
import { ScimError } from './scim.errors';

export interface ScimRequest extends Request {
  scimTenantId?: string;
}

/** Authenticates the identity provider's SCIM token; the request then acts on that organization only. */
export class ScimGuard implements RequestGuard {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlanService,
  ) {}

  async canActivate(req: ScimRequest) {
    const header = req.headers.authorization;
    const parsed = header?.startsWith('Bearer ') ? parseScimToken(header.slice(7)) : null;
    const row = parsed ? await this.prisma.tenantScim.findUnique({ where: { prefix: parsed.prefix } }) : null;
    if (!parsed || !row || !secretMatches(parsed.secret, row.secretHash)) throw new ScimError(401, 'Invalid SCIM token');
    if (!(await this.plans.plan(row.tenantId)).limits.scim) throw new ScimError(403, 'SCIM provisioning is not included in this plan');
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.tenantScim.update({ where: { tenantId: row.tenantId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }
    req.scimTenantId = row.tenantId;
    return true;
  }
}
