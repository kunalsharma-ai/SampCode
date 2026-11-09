import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { AuthUser } from '../auth/auth.types';

import { type GovernanceService } from './governance.service';

/** Blueprint phase 5: data residency and retention (administrators). */
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  get(user: AuthUser) {
    return this.governance.get(user.tenantId);
  }

  update(user: AuthUser, body: unknown) {
    return this.governance.update(user, body);
  }
}

/** Express routes of GovernanceController (mounted by src/http/app.ts). */
export function governanceControllerRoutes(r: Router, c: GovernanceController, kit: RouteKit) {
  r.get(
    '/api/organization/governance',
    ...kit.route({ controller: 'GovernanceController', handler: 'get', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.get(req.user as AuthUser),
    ),
  );
  r.put(
    '/api/organization/governance',
    ...kit.route({ controller: 'GovernanceController', handler: 'update', method: 'put', roles: ['ADMIN'] }, (req) =>
      c.update(req.user as AuthUser, req.body),
    ),
  );
}
