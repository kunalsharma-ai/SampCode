import type { Router } from 'express';
import type { RouteKit } from './http/routes';
import { type PrismaService } from './common/prisma.service';

export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  async health() {
    await this.prisma.ping();
    return { ok: true };
  }
}

/** Express routes of HealthController (mounted by src/http/app.ts). */
export function healthControllerRoutes(r: Router, c: HealthController, kit: RouteKit) {
  r.get('/api/health', ...kit.route({ controller: 'HealthController', handler: 'health', method: 'get', public: true }, () => c.health()));
}
