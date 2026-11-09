import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { config } from '../config';
import { ALL_ROLES } from '../auth/decorators';

/**
 * Settings the SampCode mobile app (apps/mobile) needs from the server it signs in to. Feature access is
 * not here: that is GET /api/me/entitlements?surface=mobile, controlled by the super admin.
 */
export class MobileController {
  /** Public so the sign-in screen can check the address and refuse an app that is too old. */
  version() {
    return { service: 'zapx', minimumAppVersion: config().MOBILE_MIN_VERSION ?? null };
  }

  settings() {
    const c = config();
    return {
      capiAppUrl: c.CAPI_APP_URL,
      runtimeBaseUrl: c.RUNTIME_BASE_URL,
      studioUrl: c.STUDIO_URL,
      minimumAppVersion: c.MOBILE_MIN_VERSION ?? null,
    };
  }
}

/** Express routes of MobileController (mounted by src/http/app.ts). */
export function mobileControllerRoutes(r: Router, c: MobileController, kit: RouteKit) {
  r.get(
    '/api/mobile/version',
    ...kit.route({ controller: 'MobileController', handler: 'version', method: 'get', public: true }, () => c.version()),
  );
  r.get(
    '/api/mobile/config',
    ...kit.route({ controller: 'MobileController', handler: 'settings', method: 'get', roles: [...ALL_ROLES] }, () => c.settings()),
  );
}
