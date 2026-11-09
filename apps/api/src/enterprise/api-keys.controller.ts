import { ForbiddenException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import { generateApiKey } from '../auth/api-keys';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.enum(['PROGRAMMER', 'VIEWER']),
  expiresInDays: z.number().int().min(1).max(730).optional(),
});

const SELECT = {
  id: true,
  name: true,
  prefix: true,
  role: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

/**
 * Organization API keys (Milestone 6) for scripts and integrations. A key acts as the member who
 * created it, with at most the key's role (programmer or viewer, never admin), and sees the same
 * projects that member sees. Admins see and can revoke every key; programmers manage their own.
 */
export class ApiKeysController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private static humanOnly(user: AuthUser) {
    if (user.apiKeyId) throw new ForbiddenException('API keys cannot manage API keys. Sign in to the studio.');
  }

  list(user: AuthUser) {
    ApiKeysController.humanOnly(user);
    return this.prisma.apiKey.findMany({
      where: { tenantId: user.tenantId, ...(user.role === 'ADMIN' ? {} : { createdById: user.id }) },
      select: SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(user: AuthUser, body: unknown) {
    ApiKeysController.humanOnly(user);
    const input = parseBody(createSchema, body);
    const { key, prefix, secretHash } = generateApiKey();
    const created = await this.prisma.apiKey.create({
      data: {
        tenantId: user.tenantId,
        createdById: user.id,
        name: input.name,
        role: input.role,
        prefix,
        secretHash,
        expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86_400_000) : null,
      },
      select: SELECT,
    });
    await this.audit.record(user, 'api_key.create', 'api_key', created.id, { name: created.name, prefix, role: created.role });
    // The only time the full key is returned. SampCode keeps a hash of the secret, not the key.
    return { ...created, key };
  }

  async revoke(user: AuthUser, id: string) {
    ApiKeysController.humanOnly(user);
    const k = await this.prisma.apiKey.findFirst({
      where: { id, tenantId: user.tenantId, ...(user.role === 'ADMIN' ? {} : { createdById: user.id }) },
    });
    if (!k) throw new NotFoundException('API key not found');
    if (!k.revokedAt) await this.prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.record(user, 'api_key.revoke', 'api_key', id, { name: k.name, prefix: k.prefix });
  }
}

/** Express routes of ApiKeysController (mounted by src/http/app.ts). */
export function apiKeysControllerRoutes(r: Router, c: ApiKeysController, kit: RouteKit) {
  r.get(
    '/api/api-keys',
    ...kit.route({ controller: 'ApiKeysController', handler: 'list', method: 'get', roles: [...CAN_EDIT] }, (req) =>
      c.list(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/api-keys',
    ...kit.route({ controller: 'ApiKeysController', handler: 'create', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.create(req.user as AuthUser, req.body),
    ),
  );
  r.delete(
    '/api/api-keys/:id',
    ...kit.route({ controller: 'ApiKeysController', handler: 'revoke', method: 'delete', status: 204, roles: [...CAN_EDIT] }, (req) =>
      c.revoke(req.user as AuthUser, req.params.id),
    ),
  );
}
