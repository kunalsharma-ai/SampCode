import type { Prisma } from '@zapx/db';
import type { AuthUser } from '../auth/auth.types';

export const isScoped = (user: Pick<AuthUser, 'role' | 'projectScope'>) => user.role !== 'ADMIN' && user.projectScope === 'ASSIGNED';

export class AccessService {
  projects(user: AuthUser): Prisma.ProjectWhereInput {
    return { tenantId: user.tenantId, deletedAt: null, ...(isScoped(user) ? { members: { some: { userId: user.id } } } : {}) };
  }

  surveys(user: AuthUser): Prisma.SurveyWhereInput {
    return { tenantId: user.tenantId, deletedAt: null, ...(isScoped(user) ? { project: { members: { some: { userId: user.id } } } } : {}) };
  }

  vendors(user: AuthUser): Prisma.VendorWhereInput {
    return { tenantId: user.tenantId, deletedAt: null, ...(isScoped(user) ? { project: { members: { some: { userId: user.id } } } } : {}) };
  }
}
