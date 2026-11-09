import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { CAN_EDIT } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { parseBody } from '../common/validation';
import { type DistributionService } from './distribution.service';

const importSchema = z.object({ csv: z.string().min(1).max(5_000_000) });
const waveSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    channel: z.enum(['EMAIL', 'SMS']).default('EMAIL'),
    subject: z.string().trim().max(200).default(''),
    body: z.string().min(1).max(20_000),
    sendAt: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    reminderDays: z.number().int().min(0).max(60).default(0),
    maxReminders: z.number().int().min(0).max(5).default(0),
    reminderSubject: z.string().trim().max(200).optional(),
  })
  .refine((w) => w.channel === 'SMS' || w.subject.length > 0, { path: ['subject'], message: 'An email needs a subject' });

/** Contacts and email invitation waves of a survey. */
export class DistributionController {
  constructor(private readonly distribution: DistributionService) {}

  contacts(user: AuthUser, id: string) {
    return this.distribution.contacts(user, id);
  }

  importContacts(user: AuthUser, id: string, body: unknown) {
    return this.distribution.importContacts(user, id, parseBody(importSchema, body).csv);
  }

  deleteContacts(user: AuthUser, id: string) {
    return this.distribution.deleteContacts(user, id);
  }

  waves(user: AuthUser, id: string) {
    return this.distribution.waves(user, id);
  }

  create(user: AuthUser, id: string, body: unknown) {
    return this.distribution.createWave(user, id, parseBody(waveSchema, body));
  }

  async cancel(user: AuthUser, id: string, waveId: string) {
    await this.distribution.cancelWave(user, id, waveId);
  }

  async links(user: AuthUser, id: string, waveId: string, res: ExpressResponse) {
    const csv = await this.distribution.linksCsv(user, id, waveId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="personal-links-${waveId}.csv"`);
    res.send(csv);
  }
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5}button{font:inherit;padding:.6rem 1.2rem}</style></head><body>${body}</body></html>`;

/** One-click unsubscribe from survey invitations (public, by the invitation's random id). */
export class UnsubscribeController {
  constructor(private readonly distribution: DistributionService) {}

  /** A page with a button: link scanners that open the link do not unsubscribe anyone. */
  form() {
    return page(
      'Unsubscribe',
      '<h1>Stop survey invitations?</h1><p>You will not get more invitations or reminders for this survey.</p><form method="post"><button type="submit">Unsubscribe</button></form>',
    );
  }

  /** The button, and one-click unsubscribe from the mail app (List-Unsubscribe-Post). */
  async unsubscribe(uid: string) {
    const ok = uid.length <= 64 && (await this.distribution.unsubscribe(uid));
    return ok
      ? page('Unsubscribed', '<h1>You are unsubscribed</h1><p>You will not get more invitations about this survey.</p>')
      : page('Link not found', '<h1>This link is not valid</h1><p>It may have been mistyped.</p>');
  }
}

/** Express routes of DistributionController (mounted by src/http/app.ts). */
export function distributionControllerRoutes(r: Router, c: DistributionController, kit: RouteKit) {
  r.get(
    '/api/surveys/:id/contacts',
    ...kit.route({ controller: 'DistributionController', handler: 'contacts', method: 'get' }, (req) =>
      c.contacts(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/contacts/import',
    ...kit.route({ controller: 'DistributionController', handler: 'importContacts', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.importContacts(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.delete(
    '/api/surveys/:id/contacts',
    ...kit.route({ controller: 'DistributionController', handler: 'deleteContacts', method: 'delete', roles: [...CAN_EDIT] }, (req) =>
      c.deleteContacts(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/distributions',
    ...kit.route({ controller: 'DistributionController', handler: 'waves', method: 'get' }, (req) =>
      c.waves(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/distributions',
    ...kit.route({ controller: 'DistributionController', handler: 'create', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.create(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/distributions/:waveId/cancel',
    ...kit.route({ controller: 'DistributionController', handler: 'cancel', method: 'post', status: 204, roles: [...CAN_EDIT] }, (req) =>
      c.cancel(req.user as AuthUser, req.params.id, req.params.waveId),
    ),
  );
  r.get(
    '/api/surveys/:id/distributions/:waveId/links.csv',
    ...kit.route({ controller: 'DistributionController', handler: 'links', method: 'get', roles: [...CAN_EDIT], raw: true }, (req, res) =>
      c.links(req.user as AuthUser, req.params.id, req.params.waveId, res),
    ),
  );
}

/** Express routes of UnsubscribeController (mounted by src/http/app.ts). */
export function unsubscribeControllerRoutes(r: Router, c: UnsubscribeController, kit: RouteKit) {
  r.get(
    '/api/public/unsubscribe/:uid',
    ...kit.route(
      {
        controller: 'UnsubscribeController',
        handler: 'form',
        method: 'get',
        public: true,
        headers: [
          ['Content-Type', 'text/html; charset=utf-8'],
          ['Cache-Control', 'no-store'],
        ],
      },
      () => c.form(),
    ),
  );
  r.post(
    '/api/public/unsubscribe/:uid',
    ...kit.route(
      {
        controller: 'UnsubscribeController',
        handler: 'unsubscribe',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 30, ttl: 60_000 },
        headers: [['Content-Type', 'text/html; charset=utf-8']],
      },
      (req) => c.unsubscribe(req.params.uid),
    ),
  );
}
