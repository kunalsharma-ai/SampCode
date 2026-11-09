import { BadRequestException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { type AccessService } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';

const addSchema = z.object({ userId: z.string().min(1).max(64) });

/**
 * Who can see a project (Milestone 6). Admins and members with "all projects" scope always can;
 * members with "assigned projects" scope only when they are added here.
 */
export class ProjectMembersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  private async project(user: AuthUser, id: string) {
    const p = await this.prisma.project.findFirst({ where: { id, ...this.access.projects(user) } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  async list(user: AuthUser, id: string) {
    await this.project(user, id);
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        role: { not: 'INTERVIEWER' },
        OR: [{ role: 'ADMIN' }, { projectScope: 'ALL' }, { projects: { some: { projectId: id } } }],
      },
      select: { id: true, name: true, email: true, role: true, projectScope: true },
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => ({ ...u, access: u.role === 'ADMIN' || u.projectScope === 'ALL' ? 'organization' : 'member' }));
  }

  async add(user: AuthUser, id: string, body: unknown) {
    await this.project(user, id);
    const { userId } = parseBody(addSchema, body);
    const member = await this.prisma.user.findFirst({ where: { id: userId, tenantId: user.tenantId } });
    if (!member) throw new NotFoundException('Member not found');
    if (member.role === 'INTERVIEWER') throw new BadRequestException('Interviewers get surveys through interviewer assignments');
    if (member.role === 'ADMIN' || member.projectScope === 'ALL')
      throw new BadRequestException(`${member.name} already sees every project. Set their access to assigned projects first.`);
    await this.prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: id, userId } },
      update: {},
      create: { projectId: id, userId, tenantId: user.tenantId, addedById: user.id },
    });
    await this.audit.record(user, 'project.member_add', 'project', id, { userId, email: member.email });
    return { ok: true };
  }

  async remove(user: AuthUser, id: string, userId: string) {
    await this.project(user, id);
    const gone = await this.prisma.projectMember.deleteMany({ where: { projectId: id, userId, tenantId: user.tenantId } });
    if (gone.count === 0) throw new NotFoundException('That member is not on this project');
    await this.audit.record(user, 'project.member_remove', 'project', id, { userId });
  }
}

/** Express routes of ProjectMembersController (mounted by src/http/app.ts). */
export function projectMembersControllerRoutes(r: Router, c: ProjectMembersController, kit: RouteKit) {
  r.get(
    '/api/projects/:id/members',
    ...kit.route({ controller: 'ProjectMembersController', handler: 'list', method: 'get' }, (req) =>
      c.list(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/projects/:id/members',
    ...kit.route({ controller: 'ProjectMembersController', handler: 'add', method: 'post', roles: ['ADMIN'] }, (req) =>
      c.add(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.delete(
    '/api/projects/:id/members/:userId',
    ...kit.route({ controller: 'ProjectMembersController', handler: 'remove', method: 'delete', status: 204, roles: ['ADMIN'] }, (req) =>
      c.remove(req.user as AuthUser, req.params.id, req.params.userId),
    ),
  );
}
