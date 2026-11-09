import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { CAN_EDIT } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { type FieldworkService } from './fieldwork.service';

const methodSchema = z.enum(['PHONE', 'VISIT', 'RECORDING']);
const sampleSchema = z.object({
  percent: z.number().min(1).max(100),
  minPerInterviewer: z.number().int().min(0).max(100).default(0),
  method: methodSchema.default('PHONE'),
});
const recordSchema = z.object({
  state: z.enum(['VERIFIED', 'FAILED', 'UNREACHABLE']),
  method: methodSchema.optional(),
  mismatches: z.array(z.string().min(1).max(64)).max(100).default([]),
  note: z.string().max(2000).optional(),
});
const decideSchema = z.object({ decision: z.enum(['uphold', 'overturn']), note: z.string().min(1).max(2000) });
const appealSchema = z.object({ clientId: z.string().uuid(), message: z.string().trim().min(5).max(2000) });
const stateSchema = z.enum(['PENDING', 'VERIFIED', 'FAILED', 'UNREACHABLE']).optional();

/** Supervisor tools in the studio: back-checks, the dashboard and appeals. */
export class FieldworkController {
  constructor(private readonly fieldwork: FieldworkService) {}

  supervisor(user: AuthUser, id: string) {
    return this.fieldwork.supervisor(user, id);
  }

  backChecks(user: AuthUser, id: string, state?: string) {
    return this.fieldwork.backChecks(user, id, parseBody(stateSchema, state?.toUpperCase() || undefined));
  }

  sample(user: AuthUser, id: string, body: unknown) {
    return this.fieldwork.sample(user, id, parseBody(sampleSchema, body));
  }

  record(user: AuthUser, id: string, checkId: string, body: unknown) {
    return this.fieldwork.recordBackCheck(user, id, checkId, parseBody(recordSchema, body));
  }

  appeals(user: AuthUser, id: string) {
    return this.fieldwork.appeals(user, id);
  }

  decide(user: AuthUser, id: string, appealId: string, body: unknown) {
    const input = parseBody(decideSchema, body);
    return this.fieldwork.decideAppeal(user, id, appealId, input.decision, input.note);
  }
}

/** Appeals from the interviewer app. */
export class CapiAppealsController {
  constructor(private readonly fieldwork: FieldworkService) {}

  mine(user: AuthUser) {
    return this.fieldwork.myInterviews(user);
  }

  appeal(user: AuthUser, body: unknown) {
    const input = parseBody(appealSchema, body);
    return this.fieldwork.appeal(user, input.clientId, input.message);
  }
}

/** Express routes of FieldworkController (mounted by src/http/app.ts). */
export function fieldworkControllerRoutes(r: Router, c: FieldworkController, kit: RouteKit) {
  r.get(
    '/api/surveys/:id/supervisor',
    ...kit.route({ controller: 'FieldworkController', handler: 'supervisor', method: 'get' }, (req) =>
      c.supervisor(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/backchecks',
    ...kit.route({ controller: 'FieldworkController', handler: 'backChecks', method: 'get' }, (req) =>
      c.backChecks(req.user as AuthUser, req.params.id, req.query.state as string),
    ),
  );
  r.post(
    '/api/surveys/:id/backchecks/sample',
    ...kit.route({ controller: 'FieldworkController', handler: 'sample', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.sample(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.put(
    '/api/surveys/:id/backchecks/:checkId',
    ...kit.route({ controller: 'FieldworkController', handler: 'record', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.record(req.user as AuthUser, req.params.id, req.params.checkId, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/appeals',
    ...kit.route({ controller: 'FieldworkController', handler: 'appeals', method: 'get' }, (req) =>
      c.appeals(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/surveys/:id/appeals/:appealId',
    ...kit.route({ controller: 'FieldworkController', handler: 'decide', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.decide(req.user as AuthUser, req.params.id, req.params.appealId, req.body),
    ),
  );
}

/** Express routes of CapiAppealsController (mounted by src/http/app.ts). */
export function capiAppealsControllerRoutes(r: Router, c: CapiAppealsController, kit: RouteKit) {
  r.get(
    '/api/capi/interviews',
    ...kit.route({ controller: 'CapiAppealsController', handler: 'mine', method: 'get', roles: ['INTERVIEWER'] }, (req) =>
      c.mine(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/capi/appeals',
    ...kit.route({ controller: 'CapiAppealsController', handler: 'appeal', method: 'post', roles: ['INTERVIEWER'] }, (req) =>
      c.appeal(req.user as AuthUser, req.body),
    ),
  );
}
