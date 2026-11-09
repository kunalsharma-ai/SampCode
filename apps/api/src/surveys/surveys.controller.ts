import { ConflictException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import { intParam, type RouteKit } from '../http/routes';
import type { Response as ExpressResponse } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config';
import { type PrismaService } from '../common/prisma.service';
import { type AuditService } from '../common/audit.service';
import { type AccessService } from '../common/access.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type SurveysService } from './surveys.service';
import { ExportRunner } from '../exports/export-runner.service';
import { signParams } from '@zapx/redirect-core';
import { testSignature } from '../interview/interview.service';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  /** Start from a built-in template (its key) or a survey saved in the question bank (its id). */
  template: z.string().max(60).optional(),
  libraryItemId: z.string().max(60).optional(),
});
const draftSchema = z.object({ definition: z.unknown(), presentation: z.unknown().optional(), expectedUpdatedAt: z.string().optional() });
const presentationBody = z.object({ presentation: z.unknown(), expectedUpdatedAt: z.string().optional() });
const quotaTargetSchema = z.object({ target: z.number().int().min(0).max(10_000_000).nullable() });
const statusSchema = z.object({ status: z.enum(['LIVE', 'PAUSED', 'CLOSED']) });
const linkSchema = z.object({
  vendorId: z.string().optional(),
  uid: z
    .string()
    .regex(/^[\x21-\x7e]{1,200}$/)
    .optional(),
  country: z.string().max(10).optional(),
  test: z.boolean().default(false),
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .optional(),
});

export class SurveysController {
  constructor(
    private readonly surveys: SurveysService,
    private readonly prisma: PrismaService,
    private readonly exports: ExportRunner,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  list(user: AuthUser, projectId: string) {
    return this.prisma.survey.findMany({ where: { projectId, ...this.access.surveys(user) }, orderBy: { createdAt: 'desc' } });
  }

  create(user: AuthUser, projectId: string, body: unknown) {
    const b = parseBody(createSchema, body);
    return this.surveys.create(user, projectId, b.name, { template: b.template, libraryItemId: b.libraryItemId });
  }

  detail(user: AuthUser, id: string) {
    return this.surveys.detail(user, id);
  }

  async draft(user: AuthUser, id: string) {
    const draft = user.role === 'VIEWER' ? await this.latest(user, id) : await this.surveys.draft(user, id);
    return { version: draft, check: this.surveys.check(draft.definition, draft.presentation) };
  }

  private async latest(user: AuthUser, id: string) {
    await this.surveys.getSurvey(user, id);
    return this.prisma.surveyVersion.findFirstOrThrow({ where: { surveyId: id }, orderBy: { version: 'desc' } });
  }

  saveDraft(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(draftSchema, body);
    return this.surveys.saveDraft(user, id, input.definition, input.expectedUpdatedAt);
  }

  savePresentation(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(presentationBody, body);
    return this.surveys.savePresentation(user, id, input.presentation, input.expectedUpdatedAt);
  }

  /** Check any definition (e.g. unsaved edits) without saving it. */
  async check(user: AuthUser, id: string, body: unknown) {
    await this.surveys.getSurvey(user, id);
    const input = parseBody(draftSchema, body);
    return this.surveys.check(input.definition, input.presentation);
  }

  publish(user: AuthUser, id: string) {
    return this.surveys.publish(user, id);
  }

  status(user: AuthUser, id: string, body: unknown) {
    return this.surveys.setStatus(user, id, parseBody(statusSchema, body).status);
  }

  /** Soft delete. A live survey must be paused or closed first. Responses are kept. */
  async remove(user: AuthUser, id: string) {
    const survey = await this.surveys.getSurvey(user, id);
    if (survey.status === 'LIVE') throw new ConflictException('Pause or close the survey before deleting it');
    await this.prisma.survey.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.record(user, 'survey.delete', 'survey', id);
  }

  versions(user: AuthUser, id: string) {
    return this.surveys.versions(user, id);
  }

  version(user: AuthUser, id: string, version: number) {
    return this.surveys.version(user, id, version);
  }

  quotas(user: AuthUser, id: string) {
    return this.surveys.quotas(user, id);
  }

  /** Live quota adjustment: change a target without republishing (null restores the published one). */
  setQuotaTarget(user: AuthUser, id: string, quotaId: string, body: unknown) {
    const { target } = parseBody(quotaTargetSchema, body);
    return this.surveys.setQuotaTarget(user, id, quotaId, target);
  }

  responses(user: AuthUser, id: string, includeTest?: string, take?: string) {
    return this.surveys.responses(user, id, { includeTest: includeTest === 'true', take: Math.min(500, Math.max(1, Number(take) || 100)) });
  }

  /**
   * Build a survey link. Vendor links carry vid/uid/cc and, if the vendor requires it, an HMAC
   * signature. Test links are signed by SampCode, are flagged in the data and never count toward quotas.
   */
  async link(user: AuthUser, id: string, body: unknown) {
    const survey = await this.surveys.getSurvey(user, id);
    const input = parseBody(linkSchema, body);
    const params: Record<string, string> = {};
    let template: string | null = null;
    const base = `${config().RUNTIME_BASE_URL.replace(/\/$/, '')}/s/${id}`;
    if (input.vendorId) {
      const vendor = await this.prisma.vendor.findFirst({
        where: { id: input.vendorId, projectId: survey.projectId, tenantId: user.tenantId },
      });
      if (!vendor) throw new NotFoundException('Vendor not found');
      params.vid = vendor.code;
      template = `${base}?vid=${encodeURIComponent(vendor.code)}&uid=[UID]`;
      if (vendor.redirectMode !== 'STATIC') template += `&${vendor.dynamicParam}=[RETURN_URL]`;
      if (vendor.requireSignedEntry) template += '&exp=[UNIX_SECONDS]&sig=[HMAC_SHA256]';
      params.uid = input.uid ?? (input.test ? `TEST-${randomBytes(4).toString('hex')}` : '');
      if (!params.uid) throw new NotFoundException('Provide a uid for a live vendor link');
      if (input.country) params.cc = input.country;
      if (input.test) {
        params.test = '1';
        params.tsig = testSignature(id, params.uid);
      }
      if (vendor.requireSignedEntry) {
        if (input.expiresInHours) params.exp = String(Math.floor(Date.now() / 1000) + input.expiresInHours * 3600);
        params.sig = signParams(params, vendor.secret);
      }
    } else {
      if (!input.test) throw new NotFoundException('Choose a vendor, or create a test link');
      params.uid = input.uid ?? `TEST-${randomBytes(4).toString('hex')}`;
      if (input.country) params.cc = input.country;
      params.test = '1';
      params.tsig = testSignature(id, params.uid);
    }
    const url = `${base}?${new URLSearchParams(params).toString()}`;
    await this.audit.record(user, input.test ? 'survey.link.test' : 'survey.link.vendor', 'survey', id, {
      vid: params.vid ?? null,
      uid: params.uid,
    });
    return { url, template };
  }

  /** Direct download for small exports (up to EXPORT_SYNC_MAX_ROWS rows); larger ones run as jobs. */
  async export(user: AuthUser, id: string, res: ExpressResponse, format = 'csv', includeTest?: string, status?: string) {
    const out = await this.exports.build(
      user,
      id,
      {
        format: format === 'xlsx' ? 'xlsx' : 'csv',
        includeTest: includeTest === 'true',
        statuses: status ? status.toUpperCase().split(',') : undefined,
      },
      { maxRows: ExportRunner.syncLimit() },
    );
    res.setHeader('Content-Type', out.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${out.name}"`);
    res.send(out.data);
  }
}

/** Express routes of SurveysController (mounted by src/http/app.ts). */
export function surveysControllerRoutes(r: Router, c: SurveysController, kit: RouteKit) {
  r.get(
    '/api/projects/:projectId/surveys',
    ...kit.route({ controller: 'SurveysController', handler: 'list', method: 'get' }, (req) =>
      c.list(req.user as AuthUser, req.params.projectId),
    ),
  );
  r.post(
    '/api/projects/:projectId/surveys',
    ...kit.route({ controller: 'SurveysController', handler: 'create', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.create(req.user as AuthUser, req.params.projectId, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id',
    ...kit.route({ controller: 'SurveysController', handler: 'detail', method: 'get' }, (req) =>
      c.detail(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/draft',
    ...kit.route({ controller: 'SurveysController', handler: 'draft', method: 'get' }, (req) =>
      c.draft(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/surveys/:id/draft',
    ...kit.route({ controller: 'SurveysController', handler: 'saveDraft', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.saveDraft(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.put(
    '/api/surveys/:id/draft/presentation',
    ...kit.route({ controller: 'SurveysController', handler: 'savePresentation', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.savePresentation(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/check',
    ...kit.route({ controller: 'SurveysController', handler: 'check', method: 'post' }, (req) =>
      c.check(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/publish',
    ...kit.route({ controller: 'SurveysController', handler: 'publish', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.publish(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/status',
    ...kit.route({ controller: 'SurveysController', handler: 'status', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.status(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.delete(
    '/api/surveys/:id',
    ...kit.route({ controller: 'SurveysController', handler: 'remove', method: 'delete', status: 204, roles: [...CAN_EDIT] }, (req) =>
      c.remove(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/versions',
    ...kit.route({ controller: 'SurveysController', handler: 'versions', method: 'get' }, (req) =>
      c.versions(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/versions/:version',
    ...kit.route({ controller: 'SurveysController', handler: 'version', method: 'get' }, (req) =>
      c.version(req.user as AuthUser, req.params.id, intParam(req.params.version)),
    ),
  );
  r.get(
    '/api/surveys/:id/quotas',
    ...kit.route({ controller: 'SurveysController', handler: 'quotas', method: 'get' }, (req) =>
      c.quotas(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/surveys/:id/quotas/:quotaId',
    ...kit.route({ controller: 'SurveysController', handler: 'setQuotaTarget', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.setQuotaTarget(req.user as AuthUser, req.params.id, req.params.quotaId, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/responses',
    ...kit.route({ controller: 'SurveysController', handler: 'responses', method: 'get' }, (req) =>
      c.responses(req.user as AuthUser, req.params.id, req.query.includeTest as string, req.query.take as string),
    ),
  );
  r.post(
    '/api/surveys/:id/links',
    ...kit.route({ controller: 'SurveysController', handler: 'link', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.link(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/export',
    ...kit.route({ controller: 'SurveysController', handler: 'export', method: 'get', raw: true }, (req, res) =>
      c.export(
        req.user as AuthUser,
        req.params.id,
        res,
        req.query.format as string | undefined,
        req.query.includeTest as string,
        req.query.status as string,
      ),
    ),
  );
}
