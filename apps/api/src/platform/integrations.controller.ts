import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';

import { type IntegrationSettingsService } from './integration-settings.service';

const values = z.record(z.string().max(64), z.string().max(20_000).optional());
const saveSchema = z.object({ enabled: z.boolean(), values: values.default({}), clear: z.array(z.string().max(64)).max(20).optional() });
const testSchema = z.object({ values: values.default({}) });

/**
 * Platform integrations (Settings > Integrations): administrators of the organization that runs the
 * installation set the keys for Claude, IPinfo, Deepgram, Twilio, Stripe and S3 here.
 */
export class PlatformIntegrationsController {
  constructor(private readonly settings: IntegrationSettingsService) {}

  list(user: AuthUser) {
    return this.settings.list(user);
  }

  save(user: AuthUser, key: string, body: unknown) {
    return this.settings.save(user, key, parseBody(saveSchema, body));
  }

  test(user: AuthUser, key: string, body: unknown) {
    return this.settings.test(user, key, parseBody(testSchema, body ?? {}).values);
  }

  reset(user: AuthUser, key: string) {
    return this.settings.reset(user, key);
  }
}

/** Express routes of PlatformIntegrationsController (mounted by src/http/app.ts). */
export function platformIntegrationsControllerRoutes(r: Router, c: PlatformIntegrationsController, kit: RouteKit) {
  r.get(
    '/api/platform/integrations',
    ...kit.route({ controller: 'PlatformIntegrationsController', handler: 'list', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.list(req.user as AuthUser),
    ),
  );
  r.put(
    '/api/platform/integrations/:key',
    ...kit.route({ controller: 'PlatformIntegrationsController', handler: 'save', method: 'put', roles: ['ADMIN'] }, (req) =>
      c.save(req.user as AuthUser, req.params.key, req.body),
    ),
  );
  r.post(
    '/api/platform/integrations/:key/test',
    ...kit.route({ controller: 'PlatformIntegrationsController', handler: 'test', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.test(req.user as AuthUser, req.params.key, req.body),
    ),
  );
  r.delete(
    '/api/platform/integrations/:key',
    ...kit.route({ controller: 'PlatformIntegrationsController', handler: 'reset', method: 'delete', roles: ['ADMIN'] }, (req) =>
      c.reset(req.user as AuthUser, req.params.key),
    ),
  );
}
