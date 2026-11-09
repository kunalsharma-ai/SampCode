import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { METRICS, OPS, TRIGGERS } from './automation-rules';
import { type AutomationService } from './automation.service';

/** Blueprint phase 5: automation rules, their runs and approvals. */
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  vocabulary() {
    return { triggers: TRIGGERS, metrics: METRICS, ops: OPS };
  }

  /** Surveys a rule can watch (the member's own access). */
  surveys(user: AuthUser) {
    return this.automation.surveys(user);
  }

  list(user: AuthUser, surveyId?: string) {
    return this.automation.list(user, surveyId);
  }

  create(user: AuthUser, body: unknown) {
    return this.automation.create(user, body);
  }

  update(user: AuthUser, id: string, body: unknown) {
    return this.automation.update(user, id, body);
  }

  async remove(user: AuthUser, id: string) {
    await this.automation.remove(user, id);
  }

  dryRun(user: AuthUser, id: string, body: { event?: Record<string, unknown> }) {
    return this.automation.dryRun(user, id, body?.event && typeof body.event === 'object' ? body.event : {});
  }

  runs(user: AuthUser, ruleId?: string, state?: string) {
    return this.automation.runs(user, { ruleId, state });
  }

  /** Approvals are for administrators only. */
  approve(user: AuthUser, id: string) {
    return this.automation.decide(user, id, 'approve');
  }

  reject(user: AuthUser, id: string) {
    return this.automation.decide(user, id, 'reject');
  }
}

/** In-app notifications of the signed-in member. */
export class NotificationsController {
  constructor(private readonly automation: AutomationService) {}

  list(user: AuthUser) {
    return this.automation.notifications(user);
  }

  async readAll(user: AuthUser) {
    await this.automation.markRead(user);
  }

  async read(user: AuthUser, id: string) {
    await this.automation.markRead(user, id);
  }
}

/** Express routes of AutomationController (mounted by src/http/app.ts). */
export function automationControllerRoutes(r: Router, c: AutomationController, kit: RouteKit) {
  r.get(
    '/api/automation/vocabulary',
    ...kit.route({ controller: 'AutomationController', handler: 'vocabulary', method: 'get' }, () => c.vocabulary()),
  );
  r.get(
    '/api/automation/surveys',
    ...kit.route({ controller: 'AutomationController', handler: 'surveys', method: 'get' }, (req) => c.surveys(req.user as AuthUser)),
  );
  r.get(
    '/api/automation/rules',
    ...kit.route({ controller: 'AutomationController', handler: 'list', method: 'get' }, (req) =>
      c.list(req.user as AuthUser, req.query.surveyId as string),
    ),
  );
  r.post(
    '/api/automation/rules',
    ...kit.route({ controller: 'AutomationController', handler: 'create', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.create(req.user as AuthUser, req.body),
    ),
  );
  r.patch(
    '/api/automation/rules/:id',
    ...kit.route({ controller: 'AutomationController', handler: 'update', method: 'patch', roles: [...CAN_EDIT] }, (req) =>
      c.update(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.delete(
    '/api/automation/rules/:id',
    ...kit.route({ controller: 'AutomationController', handler: 'remove', method: 'delete', status: 204, roles: [...CAN_EDIT] }, (req) =>
      c.remove(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/automation/rules/:id/dry-run',
    ...kit.route({ controller: 'AutomationController', handler: 'dryRun', method: 'post', status: 200, roles: [...CAN_EDIT] }, (req) =>
      c.dryRun(req.user as AuthUser, req.params.id, req.body as unknown as { event?: Record<string, unknown> }),
    ),
  );
  r.get(
    '/api/automation/runs',
    ...kit.route({ controller: 'AutomationController', handler: 'runs', method: 'get' }, (req) =>
      c.runs(req.user as AuthUser, req.query.ruleId as string, req.query.state as string),
    ),
  );
  r.post(
    '/api/automation/runs/:id/approve',
    ...kit.route({ controller: 'AutomationController', handler: 'approve', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.approve(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/automation/runs/:id/reject',
    ...kit.route({ controller: 'AutomationController', handler: 'reject', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.reject(req.user as AuthUser, req.params.id),
    ),
  );
}

/** Express routes of NotificationsController (mounted by src/http/app.ts). */
export function notificationsControllerRoutes(r: Router, c: NotificationsController, kit: RouteKit) {
  r.get(
    '/api/notifications',
    ...kit.route({ controller: 'NotificationsController', handler: 'list', method: 'get' }, (req) => c.list(req.user as AuthUser)),
  );
  r.post(
    '/api/notifications/read-all',
    ...kit.route({ controller: 'NotificationsController', handler: 'readAll', method: 'post', status: 204 }, (req) =>
      c.readAll(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/notifications/:id/read',
    ...kit.route({ controller: 'NotificationsController', handler: 'read', method: 'post', status: 204 }, (req) =>
      c.read(req.user as AuthUser, req.params.id),
    ),
  );
}
