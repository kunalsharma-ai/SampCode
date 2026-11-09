import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { CAN_EDIT } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { type QualityService, type ReviewFilter } from './quality.service';

const decisionSchema = z.object({
  responseIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  decision: z.enum(['accept', 'reject']),
  note: z.string().trim().max(500).optional(),
  /** Reject only: also block the device and network in every survey of the organization. */
  block: z.boolean().optional(),
});

const FILTERS: ReviewFilter[] = ['pending', 'accepted', 'rejected', 'flagged'];

/** Quality review queue and fieldwork dashboard for one survey. */
export class QualityController {
  constructor(private readonly quality: QualityService) {}

  queue(user: AuthUser, id: string, filter?: string, take?: string) {
    const f = FILTERS.includes(filter as ReviewFilter) ? (filter as ReviewFilter) : 'pending';
    return this.quality.queue(user, id, f, Math.min(500, Math.max(1, Number(take) || 100)));
  }

  /** Accept or reject completes. Rejecting is final: the quota place is released and the vendor is told quality_fail. */
  decide(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(decisionSchema, body);
    return this.quality.decide(user, id, [...new Set(input.responseIds)], input.decision, input.note || undefined, input.block === true);
  }

  fieldwork(user: AuthUser, id: string) {
    return this.quality.fieldwork(user, id);
  }
}

/** The organization's block list of devices and networks (Milestone 12). Administrators only. */
export class FraudBlocksController {
  constructor(private readonly quality: QualityService) {}

  list(user: AuthUser) {
    return this.quality.blocks(user);
  }

  async remove(user: AuthUser, blockId: string) {
    await this.quality.unblock(user, blockId);
  }
}

/** Express routes of QualityController (mounted by src/http/app.ts). */
export function qualityControllerRoutes(r: Router, c: QualityController, kit: RouteKit) {
  r.get(
    '/api/surveys/:id/quality',
    ...kit.route({ controller: 'QualityController', handler: 'queue', method: 'get' }, (req) =>
      c.queue(req.user as AuthUser, req.params.id, req.query.filter as string, req.query.take as string),
    ),
  );
  r.post(
    '/api/surveys/:id/quality/decisions',
    ...kit.route({ controller: 'QualityController', handler: 'decide', method: 'post', status: 200, roles: [...CAN_EDIT] }, (req) =>
      c.decide(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/fieldwork',
    ...kit.route({ controller: 'QualityController', handler: 'fieldwork', method: 'get' }, (req) =>
      c.fieldwork(req.user as AuthUser, req.params.id),
    ),
  );
}

/** Express routes of FraudBlocksController (mounted by src/http/app.ts). */
export function fraudBlocksControllerRoutes(r: Router, c: FraudBlocksController, kit: RouteKit) {
  r.get(
    '/api/quality/blocks',
    ...kit.route({ controller: 'FraudBlocksController', handler: 'list', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.list(req.user as AuthUser),
    ),
  );
  r.delete(
    '/api/quality/blocks/:blockId',
    ...kit.route({ controller: 'FraudBlocksController', handler: 'remove', method: 'delete', status: 204, roles: ['ADMIN'] }, (req) =>
      c.remove(req.user as AuthUser, req.params.blockId),
    ),
  );
}
