import { BadRequestException, UnauthorizedException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request } from 'express';
import { verifyRequest } from '@zapx/redirect-core';

import { type AuditService } from '../common/audit.service';
import { type RedirectRepository } from './redirect.repository';

const ID = /^[a-z0-9]{10,40}$/;

export class VendorApiController {
  constructor(
    private readonly repo: RedirectRepository,
    private readonly audit: AuditService,
  ) {}

  private async authenticate(req: Request) {
    const id = req.header('x-zapx-vendor') ?? '';
    const timestamp = req.header('x-zapx-timestamp');
    const signature = req.header('x-zapx-signature');
    const vendor = ID.test(id) ? await this.repo.findVendorForApi(id) : null;
    // Same answer for unknown vendor and bad signature: no way to probe for vendor ids.
    if (!vendor) throw new UnauthorizedException('Invalid vendor credentials');
    const check = verifyRequest(vendor.secret, { method: req.method, pathWithQuery: req.originalUrl, timestamp, signature });
    if (!check.ok) {
      await this.audit.record({ tenantId: vendor.tenantId }, 'vendor_api.denied', 'vendor', vendor.id, {
        reason: check.reason,
        path: req.path,
      });
      throw new UnauthorizedException(
        check.reason === 'stale_timestamp' ? 'Timestamp outside the allowed window' : 'Invalid vendor credentials',
      );
    }
    return vendor;
  }

  private static present(rows: Awaited<ReturnType<RedirectRepository['outcomesForVendor']>>) {
    return rows.map((r) => ({
      responseId: r.id,
      surveyId: r.surveyId,
      uid: r.uid,
      status: r.status.toLowerCase(),
      country: r.country,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
    }));
  }

  /** Outcomes recorded for this vendor's respondents, oldest first; page with `since`. */
  async outcomes(req: Request, since?: string, surveyId?: string, limit?: string) {
    const vendor = await this.authenticate(req);
    const sinceDate = since ? new Date(since) : undefined;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) throw new BadRequestException('since must be an ISO 8601 date-time');
    if (surveyId && !ID.test(surveyId)) throw new BadRequestException('Invalid surveyId');
    const take = Math.min(500, Math.max(1, Number(limit) || 100));
    const rows = await this.repo.outcomesForVendor(vendor.id, { since: sinceDate, surveyId, take });
    const items = VendorApiController.present(rows);
    return { items, next: items.length === take ? items[items.length - 1]!.completedAt : null };
  }

  /** Outcomes for one respondent id (one per survey). */
  async outcome(req: Request, uid: string, surveyId?: string) {
    const vendor = await this.authenticate(req);
    if (uid.length > 200) throw new BadRequestException('Invalid uid');
    if (surveyId && !ID.test(surveyId)) throw new BadRequestException('Invalid surveyId');
    return { items: VendorApiController.present(await this.repo.outcomesForVendor(vendor.id, { uid, surveyId, take: 100 })) };
  }
}

/** Express routes of VendorApiController (mounted by src/http/app.ts). */
export function vendorApiControllerRoutes(r: Router, c: VendorApiController, kit: RouteKit) {
  r.get(
    '/api/v1/vendor/outcomes',
    ...kit.route(
      { controller: 'VendorApiController', handler: 'outcomes', method: 'get', public: true, throttle: { limit: 120, ttl: 60_000 } },
      (req) =>
        c.outcomes(
          req,
          req.query.since as unknown as string,
          req.query.surveyId as unknown as string,
          req.query.limit as unknown as string,
        ),
    ),
  );
  r.get(
    '/api/v1/vendor/outcomes/:uid',
    ...kit.route(
      { controller: 'VendorApiController', handler: 'outcome', method: 'get', public: true, throttle: { limit: 120, ttl: 60_000 } },
      (req) => c.outcome(req, req.params.uid, req.query.surveyId as unknown as string),
    ),
  );
}
