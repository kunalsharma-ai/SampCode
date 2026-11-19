import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request, Response } from 'express';
import { parseBody } from '../common/validation';
import { ALL_ROLES } from '../auth/decorators';
import { CLIENT_HEADER, type AuthUser } from '../auth/auth.types';
import { type SuperAdminService } from './super-admin.service';
import { type EntitlementsService } from './entitlements.service';
import { type PlatformAutomationService } from './platform-automation.service';
import { FEATURES, isSurface, type Surface } from './features';
import { ACTION_LABELS, TEMPLATES, TRIGGERS, automationSchema } from './platform-automation';
import {
  activitySchema,
  createOrgSchema,
  createUserSchema,
  featureChangeSchema,
  newPlanSchema,
  orgPatchSchema,
  overridesSchema,
  planSchema,
  suspendSchema,
  userPatchSchema,
} from './super-admin.schemas';

/** How often an open entitlements stream re-checks the database (changes made by other processes). */
const STREAM_CHECK_MS = 3_000;
const STREAM_PING_MS = 25_000;

const surfaceOf = (q: unknown, header: unknown): Surface => (isSurface(q) ? q : header === 'mobile' ? 'mobile' : 'web');

/**
 * What every signed-in member can ask about their own features (the web CRM and the mobile app use
 * these to show or hide screens). Reachable even when the organization is suspended.
 */
export class EntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  /** The feature catalog: every key with its label, group and the surfaces it exists on. */
  features() {
    return FEATURES.map(({ key, label, group, description, surfaces }) => ({ key, label, group, description, surfaces }));
  }

  /** The member's features for ?surface=web|mobile (default: the X-ZAPX-Client header, else web). ETag = version. */
  async mine(user: AuthUser, surface: unknown, client: unknown, ifNoneMatch: string | undefined, res: Response) {
    const ent = await this.entitlements.forUser(user.id, surfaceOf(surface, client));
    const etag = `"${ent.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim().replace(/^W\//, '') === etag)) {
      res.status(304);
      return undefined;
    }
    return ent;
  }

  /** Server-sent events: "entitlements" with the same body as GET me/entitlements, whenever it changes. */
  async stream(user: AuthUser, surface: unknown, client: unknown, req: Request, res: Response) {
    const s = surfaceOf(surface, client);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let last = '';
    let closed = false;
    const push = async () => {
      if (closed) return;
      try {
        const ent = await this.entitlements.forUser(user.id, s);
        if (ent.version === last || closed) return;
        last = ent.version;
        res.write(`event: entitlements\nid: ${ent.version}\ndata: ${JSON.stringify(ent)}\n\n`);
      } catch {
        // The member was deleted: end the stream.
        res.end();
      }
    };
    await push();
    const off = this.entitlements.onChange(() => void push());
    const check = setInterval(() => void push(), STREAM_CHECK_MS);
    const ping = setInterval(() => !closed && res.write(': ping\n\n'), STREAM_PING_MS);
    req.on('close', () => {
      closed = true;
      off();
      clearInterval(check);
      clearInterval(ping);
    });
  }
}

/**
 * The super admin console's API. The auth guard lets only a signed-in super admin (never an API key)
 * reach any route of this controller.
 */
export class SuperAdminController {
  constructor(
    private readonly svc: SuperAdminService,
    private readonly automation: PlatformAutomationService,
  ) {}

  overview() {
    return this.svc.overview();
  }

  // Plans
  plans() {
    return this.svc.listPlans();
  }

  createPlan(user: AuthUser, body: unknown) {
    return this.svc.createPlan(user, parseBody(newPlanSchema, body));
  }

  updatePlan(user: AuthUser, code: string, body: unknown) {
    return this.svc.updatePlan(user, code, parseBody(planSchema, body));
  }

  deletePlan(user: AuthUser, code: string) {
    return this.svc.deletePlan(user, code);
  }

  // Organizations
  organizations(q?: string, status?: string) {
    return this.svc.listOrganizations(q?.slice(0, 120), status?.slice(0, 20));
  }

  createOrganization(user: AuthUser, body: unknown) {
    return this.svc.createOrganization(user, parseBody(createOrgSchema, body));
  }

  organization(id: string) {
    return this.svc.organization(id);
  }

  updateOrganization(user: AuthUser, id: string, body: unknown) {
    return this.svc.updateOrganization(user, id, parseBody(orgPatchSchema, body));
  }

  setFeatures(user: AuthUser, id: string, body: unknown) {
    return this.svc.setOrganizationFeatures(user, id, parseBody(overridesSchema, body));
  }

  setFeature(user: AuthUser, id: string, body: unknown) {
    return this.svc.setOrganizationFeature(user, id, parseBody(featureChangeSchema, body));
  }

  suspend(user: AuthUser, id: string, body: unknown) {
    return this.svc.suspend(user, id, parseBody(suspendSchema, body ?? {}).reason);
  }

  reactivate(user: AuthUser, id: string) {
    return this.svc.reactivate(user, id);
  }

  createMember(user: AuthUser, id: string, body: unknown) {
    return this.svc.createUser(user, id, parseBody(createUserSchema, body));
  }

  // Members
  users(q?: string, tenantId?: string) {
    return this.svc.listUsers(q?.slice(0, 120), tenantId?.slice(0, 64));
  }

  updateUser(user: AuthUser, id: string, body: unknown) {
    return this.svc.updateUser(user, id, parseBody(userPatchSchema, body));
  }

  resetLink(user: AuthUser, id: string) {
    return this.svc.userResetLink(user, id);
  }

  credentials(user: AuthUser, id: string) {
    return this.svc.generateCredentials(user, id);
  }

  // Activity and integrations
  activity(query: unknown) {
    return this.svc.activity(parseBody(activitySchema, query));
  }

  integrations(user: AuthUser) {
    return this.svc.integrationsOverview(user);
  }

  // Automation
  vocabulary() {
    return {
      triggers: Object.entries(TRIGGERS).map(([key, t]) => ({ key, ...t })),
      actions: Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label })),
      templates: TEMPLATES,
    };
  }

  rules() {
    return this.automation.list();
  }

  createRule(user: AuthUser, body: unknown) {
    return this.automation.create(user, parseBody(automationSchema, body));
  }

  updateRule(user: AuthUser, id: string, body: unknown) {
    return this.automation.update(user, id, parseBody(automationSchema.partial(), body));
  }

  deleteRule(user: AuthUser, id: string) {
    return this.automation.remove(user, id);
  }

  preview(id: string) {
    return this.automation.preview(id);
  }

  /** Run every enabled rule (or one, with ?rule=) now instead of waiting for the schedule. */
  async runNow(rule?: string) {
    return { fired: await this.automation.sweep(rule?.slice(0, 64)) };
  }

  runs(rule?: string) {
    return this.automation.runs(rule?.slice(0, 64));
  }
}

/** Express routes of EntitlementsController (mounted by src/http/app.ts). */
export function entitlementsControllerRoutes(r: Router, c: EntitlementsController, kit: RouteKit) {
  r.get(
    '/api/features',
    ...kit.route({ controller: 'EntitlementsController', handler: 'features', method: 'get', roles: [...ALL_ROLES] }, () => c.features()),
  );
  r.get(
    '/api/me/entitlements',
    ...kit.route({ controller: 'EntitlementsController', handler: 'mine', method: 'get', roles: [...ALL_ROLES] }, (req, res) =>
      c.mine(
        req.user as AuthUser,
        req.query.surface,
        req.headers[CLIENT_HEADER.toLowerCase()],
        req.headers['if-none-match'] as unknown as string | undefined,
        res,
      ),
    ),
  );
  r.get(
    '/api/me/entitlements/stream',
    ...kit.route(
      { controller: 'EntitlementsController', handler: 'stream', method: 'get', roles: [...ALL_ROLES], throttle: false, raw: true },
      (req, res) => c.stream(req.user as AuthUser, req.query.surface, req.headers[CLIENT_HEADER.toLowerCase()], req, res),
    ),
  );
}

/** Express routes of SuperAdminController (mounted by src/http/app.ts). */
export function superAdminControllerRoutes(r: Router, c: SuperAdminController, kit: RouteKit) {
  r.get(
    '/api/super/overview',
    ...kit.route({ controller: 'SuperAdminController', handler: 'overview', method: 'get' }, () => c.overview()),
  );
  r.get('/api/super/plans', ...kit.route({ controller: 'SuperAdminController', handler: 'plans', method: 'get' }, () => c.plans()));
  r.post(
    '/api/super/plans',
    ...kit.route({ controller: 'SuperAdminController', handler: 'createPlan', method: 'post' }, (req) =>
      c.createPlan(req.user as AuthUser, req.body),
    ),
  );
  r.put(
    '/api/super/plans/:code',
    ...kit.route({ controller: 'SuperAdminController', handler: 'updatePlan', method: 'put' }, (req) =>
      c.updatePlan(req.user as AuthUser, req.params.code, req.body),
    ),
  );
  r.delete(
    '/api/super/plans/:code',
    ...kit.route({ controller: 'SuperAdminController', handler: 'deletePlan', method: 'delete', status: 204 }, (req) =>
      c.deletePlan(req.user as AuthUser, req.params.code),
    ),
  );
  r.get(
    '/api/super/organizations',
    ...kit.route({ controller: 'SuperAdminController', handler: 'organizations', method: 'get' }, (req) =>
      c.organizations(req.query.q as string, req.query.status as string),
    ),
  );
  r.post(
    '/api/super/organizations',
    ...kit.route({ controller: 'SuperAdminController', handler: 'createOrganization', method: 'post' }, (req) =>
      c.createOrganization(req.user as AuthUser, req.body),
    ),
  );
  r.get(
    '/api/super/organizations/:id',
    ...kit.route({ controller: 'SuperAdminController', handler: 'organization', method: 'get' }, (req) => c.organization(req.params.id)),
  );
  r.patch(
    '/api/super/organizations/:id',
    ...kit.route({ controller: 'SuperAdminController', handler: 'updateOrganization', method: 'patch' }, (req) =>
      c.updateOrganization(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.put(
    '/api/super/organizations/:id/features',
    ...kit.route({ controller: 'SuperAdminController', handler: 'setFeatures', method: 'put' }, (req) =>
      c.setFeatures(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.patch(
    '/api/super/organizations/:id/features',
    ...kit.route({ controller: 'SuperAdminController', handler: 'setFeature', method: 'patch' }, (req) =>
      c.setFeature(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/super/organizations/:id/suspend',
    ...kit.route({ controller: 'SuperAdminController', handler: 'suspend', method: 'post', status: 204 }, (req) =>
      c.suspend(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/super/organizations/:id/reactivate',
    ...kit.route({ controller: 'SuperAdminController', handler: 'reactivate', method: 'post', status: 204 }, (req) =>
      c.reactivate(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/super/organizations/:id/members',
    ...kit.route({ controller: 'SuperAdminController', handler: 'createMember', method: 'post' }, (req) =>
      c.createMember(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/super/users',
    ...kit.route({ controller: 'SuperAdminController', handler: 'users', method: 'get' }, (req) =>
      c.users(req.query.q as string, req.query.tenantId as string),
    ),
  );
  r.patch(
    '/api/super/users/:id',
    ...kit.route({ controller: 'SuperAdminController', handler: 'updateUser', method: 'patch' }, (req) =>
      c.updateUser(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/super/users/:id/credentials',
    ...kit.route({ controller: 'SuperAdminController', handler: 'credentials', method: 'post' }, (req) =>
      c.credentials(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/super/users/:id/password-reset',
    ...kit.route({ controller: 'SuperAdminController', handler: 'resetLink', method: 'post' }, (req) =>
      c.resetLink(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/super/activity',
    ...kit.route({ controller: 'SuperAdminController', handler: 'activity', method: 'get' }, (req) => c.activity(req.query)),
  );
  r.get(
    '/api/super/integrations',
    ...kit.route({ controller: 'SuperAdminController', handler: 'integrations', method: 'get' }, (req) =>
      c.integrations(req.user as AuthUser),
    ),
  );
  r.get(
    '/api/super/automation/vocabulary',
    ...kit.route({ controller: 'SuperAdminController', handler: 'vocabulary', method: 'get' }, () => c.vocabulary()),
  );
  r.get(
    '/api/super/automation/rules',
    ...kit.route({ controller: 'SuperAdminController', handler: 'rules', method: 'get' }, () => c.rules()),
  );
  r.post(
    '/api/super/automation/rules',
    ...kit.route({ controller: 'SuperAdminController', handler: 'createRule', method: 'post' }, (req) =>
      c.createRule(req.user as AuthUser, req.body),
    ),
  );
  r.patch(
    '/api/super/automation/rules/:id',
    ...kit.route({ controller: 'SuperAdminController', handler: 'updateRule', method: 'patch' }, (req) =>
      c.updateRule(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.delete(
    '/api/super/automation/rules/:id',
    ...kit.route({ controller: 'SuperAdminController', handler: 'deleteRule', method: 'delete', status: 204 }, (req) =>
      c.deleteRule(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/super/automation/rules/:id/preview',
    ...kit.route({ controller: 'SuperAdminController', handler: 'preview', method: 'get' }, (req) => c.preview(req.params.id)),
  );
  r.post(
    '/api/super/automation/run',
    ...kit.route({ controller: 'SuperAdminController', handler: 'runNow', method: 'post', status: 200 }, (req) =>
      c.runNow(req.query.rule as string),
    ),
  );
  r.get(
    '/api/super/automation/runs',
    ...kit.route({ controller: 'SuperAdminController', handler: 'runs', method: 'get' }, (req) => c.runs(req.query.rule as string)),
  );
}
