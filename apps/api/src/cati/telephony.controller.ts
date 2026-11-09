import { ForbiddenException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type TelephonyService } from './telephony.service';

const CALLERS = ['ADMIN', 'PROGRAMMER', 'INTERVIEWER'] as const;
const phoneSchema = z.object({ phone: z.string().max(40).nullable() });
const dialerSchema = z.object({
  enabled: z.boolean(),
  recordCalls: z.boolean(),
  recordingNotice: z.string().max(300).optional(),
});

/** The phone dialer (Milestone 19): settings, calls, and the Twilio webhooks. */
export class TelephonyController {
  constructor(private readonly telephony: TelephonyService) {}

  me(user: AuthUser) {
    return this.telephony.me(user);
  }

  setPhone(user: AuthUser, body: unknown) {
    return this.telephony.setMyPhone(user, parseBody(phoneSchema, body).phone);
  }

  dialer(user: AuthUser, id: string) {
    return this.telephony.dialer(user, id);
  }

  setDialer(user: AuthUser, id: string, body: unknown) {
    return this.telephony.setDialer(user, id, parseBody(dialerSchema, body));
  }

  dial(user: AuthUser, id: string) {
    return this.telephony.dial(user, id);
  }

  async latest(user: AuthUser, id: string) {
    return { dial: await this.telephony.latest(user, id) };
  }

  hangUp(user: AuthUser, id: string) {
    return this.telephony.hangUp(user, id);
  }

  // ---- Twilio webhooks: authenticated by X-Twilio-Signature, not by a session ----

  private verified(req: Request) {
    const params = (req.body ?? {}) as Record<string, unknown>;
    const path = req.originalUrl.replace(/^\/api(?=\/)/, '');
    const sig = req.headers['x-twilio-signature'];
    if (!this.telephony.verifyTwilio(path, params, typeof sig === 'string' ? sig : undefined))
      throw new ForbiddenException('Invalid Twilio signature');
    return params;
  }

  answer(req: Request, d: string) {
    this.verified(req);
    return this.telephony.onAnswer(d);
  }

  notice(req: Request, d: string) {
    this.verified(req);
    return this.telephony.onNotice(d);
  }

  bridged(req: Request, d: string) {
    return this.telephony.onBridged(d, this.verified(req));
  }

  status(req: Request, d: string) {
    return this.telephony.onStatus(d, this.verified(req));
  }

  recording(req: Request, d: string) {
    return this.telephony.onRecording(d, this.verified(req));
  }
}

/** Express routes of TelephonyController (mounted by src/http/app.ts). */
export function telephonyControllerRoutes(r: Router, c: TelephonyController, kit: RouteKit) {
  r.get(
    '/api/cati/me',
    ...kit.route({ controller: 'TelephonyController', handler: 'me', method: 'get', roles: [...CALLERS] }, (req) =>
      c.me(req.user as AuthUser),
    ),
  );
  r.put(
    '/api/cati/me/phone',
    ...kit.route({ controller: 'TelephonyController', handler: 'setPhone', method: 'put', roles: [...CALLERS] }, (req) =>
      c.setPhone(req.user as AuthUser, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/cati/dialer',
    ...kit.route({ controller: 'TelephonyController', handler: 'dialer', method: 'get', roles: ['ADMIN', 'PROGRAMMER', 'VIEWER'] }, (req) =>
      c.dialer(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/surveys/:id/cati/dialer',
    ...kit.route({ controller: 'TelephonyController', handler: 'setDialer', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.setDialer(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/cati/cases/:id/dial',
    ...kit.route({ controller: 'TelephonyController', handler: 'dial', method: 'post', status: 200, roles: [...CALLERS] }, (req) =>
      c.dial(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/cati/cases/:id/dial',
    ...kit.route({ controller: 'TelephonyController', handler: 'latest', method: 'get', roles: [...CALLERS] }, (req) =>
      c.latest(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/cati/dials/:id/hangup',
    ...kit.route({ controller: 'TelephonyController', handler: 'hangUp', method: 'post', status: 200, roles: [...CALLERS] }, (req) =>
      c.hangUp(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/telephony/twilio/answer',
    ...kit.route(
      {
        controller: 'TelephonyController',
        handler: 'answer',
        method: 'post',
        status: 200,
        public: true,
        throttle: false,
        headers: [['Content-Type', 'text/xml']],
      },
      (req) => c.answer(req, req.query.d as string),
    ),
  );
  r.post(
    '/api/telephony/twilio/notice',
    ...kit.route(
      {
        controller: 'TelephonyController',
        handler: 'notice',
        method: 'post',
        status: 200,
        public: true,
        throttle: false,
        headers: [['Content-Type', 'text/xml']],
      },
      (req) => c.notice(req, req.query.d as string),
    ),
  );
  r.post(
    '/api/telephony/twilio/bridged',
    ...kit.route(
      {
        controller: 'TelephonyController',
        handler: 'bridged',
        method: 'post',
        status: 200,
        public: true,
        throttle: false,
        headers: [['Content-Type', 'text/xml']],
      },
      (req) => c.bridged(req, req.query.d as string),
    ),
  );
  r.post(
    '/api/telephony/twilio/status',
    ...kit.route(
      { controller: 'TelephonyController', handler: 'status', method: 'post', status: 204, public: true, throttle: false },
      (req) => c.status(req, req.query.d as string),
    ),
  );
  r.post(
    '/api/telephony/twilio/recording',
    ...kit.route(
      { controller: 'TelephonyController', handler: 'recording', method: 'post', status: 204, public: true, throttle: false },
      (req) => c.recording(req, req.query.d as string),
    ),
  );
}
