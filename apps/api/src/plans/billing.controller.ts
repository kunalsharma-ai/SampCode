import { BadRequestException, UnauthorizedException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';

import { type BillingService, StripeSignatureError } from './billing.service';

const checkoutSchema = z.object({ plan: z.enum(['free', 'team', 'business', 'enterprise']) });

/** Billing (Milestone 13): admins buy and manage the plan; Stripe reports subscription changes. */
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  summary(user: AuthUser) {
    return this.billing.summary(user.tenantId);
  }

  checkout(user: AuthUser, body: unknown) {
    return this.billing.checkout(user, parseBody(checkoutSchema, body).plan);
  }

  portal(user: AuthUser) {
    return this.billing.portal(user);
  }

  /** Stripe webhooks. Authenticated by the Stripe-Signature header over the raw body. */
  async webhook(req: Request & { rawBody?: Buffer }, signature?: string) {
    try {
      return await this.billing.webhook(req.rawBody, signature);
    } catch (e) {
      if (e instanceof StripeSignatureError) throw new UnauthorizedException(`Invalid Stripe signature: ${e.message}`);
      if (e instanceof SyntaxError) throw new BadRequestException('Not JSON');
      throw e;
    }
  }
}

/** Express routes of BillingController (mounted by src/http/app.ts). */
export function billingControllerRoutes(r: Router, c: BillingController, kit: RouteKit) {
  r.get(
    '/api/billing',
    ...kit.route({ controller: 'BillingController', handler: 'summary', method: 'get', roles: ['ADMIN'] }, (req) =>
      c.summary(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/billing/checkout',
    ...kit.route({ controller: 'BillingController', handler: 'checkout', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.checkout(req.user as AuthUser, req.body),
    ),
  );
  r.post(
    '/api/billing/portal',
    ...kit.route({ controller: 'BillingController', handler: 'portal', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.portal(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/billing/webhook',
    ...kit.route(
      { controller: 'BillingController', handler: 'webhook', method: 'post', status: 200, public: true, throttle: false },
      (req) => c.webhook(req, req.headers['stripe-signature'] as unknown as string),
    ),
  );
}
