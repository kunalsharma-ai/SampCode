import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type SampleonService } from './sampleon.service';

export class SampleonController {
  constructor(private readonly sampleon: SampleonService) {}

  /** Audience requests for this survey, and the launch URL SAMPLEON (or PROJEXA) should use. */
  overview(user: AuthUser, id: string) {
    return this.sampleon.overview(user, id);
  }

  /**
   * Make the survey ready to receive SAMPLEON respondents (creates the project's SAMPLEON vendor)
   * and return the launch URL. Used for PROJEXA-linked surveys, where PROJEXA sends the request.
   */
  connect(user: AuthUser, id: string) {
    return this.sampleon.connect(user, id);
  }

  /** Ask SAMPLEON for an audience for an independent SampCode survey. */
  submit(user: AuthUser, id: string, body: unknown) {
    return this.sampleon.submit(user, id, body);
  }

  /** SAMPLEON's signed event webhook. */
  events(req: Request & { rawBody?: Buffer }) {
    return this.sampleon.receive(req);
  }
}

/** Express routes of SampleonController (mounted by src/http/app.ts). */
export function sampleonControllerRoutes(r: Router, c: SampleonController, kit: RouteKit) {
  r.get(
    '/api/surveys/:id/sampleon',
    ...kit.route({ controller: 'SampleonController', handler: 'overview', method: 'get' }, (req) =>
      c.overview(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/sampleon/connect',
    ...kit.route({ controller: 'SampleonController', handler: 'connect', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.connect(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/sampleon/audience-requests',
    ...kit.route({ controller: 'SampleonController', handler: 'submit', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.submit(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/v1/sampleon/events',
    ...kit.route(
      {
        controller: 'SampleonController',
        handler: 'events',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 600, ttl: 60_000 },
      },
      (req) => c.events(req),
    ),
  );
}
