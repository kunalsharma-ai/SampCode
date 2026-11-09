import { BadRequestException, ForbiddenException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { isCommonPassword } from '../auth/password-policy';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';

import { type PlanService } from '../plans/plan.service';
import { type PasswordResetService } from '../auth/password-reset.service';

const createSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().toLowerCase(),
  password: z
    .string()
    .min(10)
    .max(200)
    .refine((p) => !isCommonPassword(p), 'This password is too common. Choose another one.'),
  role: z.enum(['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER']),
  projectScope: z.enum(['ALL', 'ASSIGNED']).default('ALL'),
});

const updateSchema = z
  .object({
    role: z.enum(['ADMIN', 'PROGRAMMER', 'VIEWER', 'INTERVIEWER']).optional(),
    projectScope: z.enum(['ALL', 'ASSIGNED']).optional(),
    /** Disable (true) or re-enable (false) the member. Disabled members cannot sign in. */
    disabled: z.boolean().optional(),
  })
  .refine((v) => v.role || v.projectScope || v.disabled !== undefined, 'Nothing to change');

export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  projectScope: true,
  disabledAt: true,
  ssoSubject: true,
  scimExternalId: true,
  createdAt: true,
} as const;
const SELECT = USER_SELECT;

/** Admins always see every project; "assigned projects" only applies to programmers and viewers. */
export const scopeFor = (role: string, scope: 'ALL' | 'ASSIGNED') => (role === 'PROGRAMMER' || role === 'VIEWER' ? scope : 'ALL');

/** Team members within the caller's tenant. Admins only. */
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly plans: PlanService,
    private readonly resets: PasswordResetService,
  ) {}

  /**
   * One-time link for a member to set a new password (security fix after the handbook review).
   * The link is returned once for the administrator to pass on and, when email is set up, also
   * emailed to the member. It voids the member's older links; their current password keeps
   * working until the link is used.
   */
  async resetLink(user: AuthUser, id: string) {
    const member = await this.prisma.user.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.disabledAt) throw new BadRequestException('Enable this member before resetting their password');
    if (id === user.id) throw new BadRequestException('Change your own password in your profile instead');
    const link = await this.resets.create(member, user.id);
    const emailed = await this.resets.email({ email: member.email, name: member.name }, link.url, link.expiresAt, true);
    await this.audit.record(user, 'user.password_reset_link', 'user', id, { emailed });
    return { url: link.url, expiresAt: link.expiresAt, emailed };
  }

  list(user: AuthUser) {
    return this.prisma.user.findMany({
      where: { tenantId: user.tenantId },
      select: { ...SELECT, _count: { select: { projects: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(user: AuthUser, body: unknown) {
    const input = parseBody(createSchema, body);
    if (await this.prisma.user.findUnique({ where: { email: input.email } }))
      throw new ForbiddenException('An account with this email already exists');
    await this.plans.assertSeat(user.tenantId, input.role);
    const created = await this.prisma.user.create({
      data: {
        tenantId: user.tenantId,
        email: input.email,
        name: input.name,
        role: input.role,
        projectScope: scopeFor(input.role, input.projectScope),
        passwordHash: await hash(input.password, 10),
      },
      select: SELECT,
    });
    await this.audit.record(user, 'user.create', 'user', created.id, {
      email: created.email,
      role: created.role,
      projectScope: created.projectScope,
    });
    return created;
  }

  /** Change a member's role or project access. Applies to their next request (the guard reads it fresh). */
  async update(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(updateSchema, body);
    const before = await this.prisma.user.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!before) throw new NotFoundException('Member not found');
    if (id === user.id && input.role && input.role !== 'ADMIN') throw new BadRequestException('You cannot remove your own admin role');
    if (id === user.id && input.disabled) throw new BadRequestException('You cannot disable yourself');
    const role = input.role ?? before.role;
    const projectScope = scopeFor(role, input.projectScope ?? before.projectScope);
    const disabledAt = input.disabled === undefined ? before.disabledAt : input.disabled ? (before.disabledAt ?? new Date()) : null;
    // Re-enabling, or moving between interviewer and studio seats, takes a seat of the new kind.
    const kind = (r: string) => (r === 'INTERVIEWER' ? 'i' : 's');
    if (!disabledAt && (before.disabledAt || kind(role) !== kind(before.role))) await this.plans.assertSeat(user.tenantId, role);
    const updated = await this.prisma.user.update({ where: { id }, data: { role, projectScope, disabledAt }, select: SELECT });
    await this.audit.record(
      user,
      input.disabled === undefined ? 'user.update' : input.disabled ? 'user.disable' : 'user.enable',
      'user',
      id,
      {
        before: { role: before.role, projectScope: before.projectScope, disabled: !!before.disabledAt },
        after: { role, projectScope, disabled: !!disabledAt },
      },
    );
    return updated;
  }
}

/** Express routes of UsersController (mounted by src/http/app.ts). */
export function usersControllerRoutes(r: Router, c: UsersController, kit: RouteKit) {
  r.post(
    '/api/users/:id/password-reset',
    ...kit.route({ controller: 'UsersController', handler: 'resetLink', method: 'post', status: 201, roles: ['ADMIN'] }, (req) =>
      c.resetLink(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/users',
    ...kit.route({ controller: 'UsersController', handler: 'list', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.list(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/users',
    ...kit.route({ controller: 'UsersController', handler: 'create', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.create(req.user as AuthUser, req.body),
    ),
  );
  r.patch(
    '/api/users/:id',
    ...kit.route({ controller: 'UsersController', handler: 'update', method: 'patch', roles: ['ADMIN'] }, (req) =>
      c.update(req.user as AuthUser, req.params.id, req.body),
    ),
  );
}
