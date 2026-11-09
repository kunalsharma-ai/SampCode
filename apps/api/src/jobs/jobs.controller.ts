import { BadRequestException, HttpException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import { type AuditService } from '../common/audit.service';
import { config } from '../config';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { MAX_QA_JOB_RESPONDENTS, qaRunSchema } from '../qa/qa.controller';
import { type ProposeService } from '../ai/propose.service';
import { notConfigured } from '../ai/claude.provider';
import { classifyFile, toAiDocument, type UploadedFile } from '../imports/documents';
import { type SurveysService } from '../surveys/surveys.service';
import { type FilesService } from './files.service';
import { type JobsService, presentJob } from './jobs.service';
import { type JobWorker } from './job.worker';

const exportSchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  includeTest: z.boolean().default(false),
  statuses: z
    .array(
      z.enum([
        'IN_PROGRESS',
        'COMPLETE',
        'TERMINATE',
        'QUOTA_FULL',
        'QUALITY_FAIL',
        'SECURITY_REJECT',
        'DUPLICATE',
        'PARTIAL',
        'TECHNICAL_ERROR',
      ]),
    )
    .optional(),
});
const qaJobSchema = qaRunSchema(MAX_QA_JOB_RESPONDENTS);
const aiSchema = z.object({ instruction: z.string().max(20000).default('') });

const upload = () => ({ field: 'file', limits: { fileSize: config().UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 10 } });
/** Documents for an AI job are kept only until the job has had time to run. */
const UPLOAD_TTL_MS = 24 * 3_600_000;

/**
 * Background jobs (Milestone 7). Each endpoint queues a job and answers 202 with it at once; poll
 * GET /api/jobs/:id for progress. Export results are downloaded from GET /api/files/:id.
 */
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly files: FilesService,
    private readonly surveys: SurveysService,
    private readonly proposer: ProposeService,
    private readonly worker: JobWorker,
    private readonly audit: AuditService,
  ) {}

  /** Start the in-process worker straight away when it runs here, so small jobs finish quickly. */
  private kick() {
    if (config().JOB_WORKER === 'on') void this.worker.runOnce().catch(() => undefined);
  }

  async export(user: AuthUser, id: string, body: unknown, res: ExpressResponse) {
    const input = parseBody(exportSchema, body ?? {});
    const job = await this.jobs.enqueue(user, 'export', id, input);
    this.kick();
    res.status(202);
    return presentJob(job);
  }

  async qa(user: AuthUser, id: string, body: unknown, res: ExpressResponse) {
    const input = parseBody(qaJobSchema, body ?? {});
    const job = await this.jobs.enqueue(user, 'qa_run', id, input);
    this.kick();
    res.status(202);
    return presentJob(job);
  }

  async ai(user: AuthUser, id: string, body: unknown, res: ExpressResponse, file?: UploadedFile) {
    const { instruction } = parseBody(aiSchema, body ?? {});
    if (!instruction.trim() && !file) throw new BadRequestException('Describe what to build or change, or attach a questionnaire.');
    if (!this.proposer.configured) {
      const e = notConfigured();
      throw new HttpException({ message: e.message, code: e.code }, e.status);
    }
    await this.surveys.getSurvey(user, id);
    let documentFileId: string | undefined;
    if (file) {
      // Validate and convert now, so a bad file is refused at once rather than failing later.
      const kind = classifyFile(file);
      if (kind === 'xlsx') throw new BadRequestException('Excel files are imported with the template importer. Use Import file instead.');
      const doc = await toAiDocument(file, kind);
      const saved = await this.files.save({
        tenantId: user.tenantId,
        surveyId: id,
        purpose: 'upload',
        name: file.originalname,
        contentType: 'application/json',
        data: Buffer.from(JSON.stringify(doc), 'utf8'),
        ttlMs: UPLOAD_TTL_MS,
        createdById: user.id,
      });
      documentFileId = saved.id;
    }
    const job = await this.jobs.enqueue(
      user,
      'ai_propose',
      id,
      { instruction, documentFileId, fileName: file?.originalname },
      { maxAttempts: 1 },
    );
    this.kick();
    res.status(202);
    return presentJob(job);
  }

  async list(user: AuthUser, id: string, type?: string) {
    return (await this.jobs.list(user, id, type)).map(presentJob);
  }

  async get(user: AuthUser, id: string) {
    return presentJob(await this.jobs.get(user, id));
  }

  async cancel(user: AuthUser, id: string) {
    return presentJob(await this.jobs.cancel(user, id));
  }

  /** Download an export file. Only files produced by a job the member can see, before they expire. */
  async download(user: AuthUser, id: string, res: ExpressResponse) {
    const file = await this.files.find(user.tenantId, id);
    if (file.purpose !== 'export' || !file.jobId) throw new NotFoundException('This file has expired or does not exist');
    await this.jobs.get(user, file.jobId);
    const data = await this.files.bytes(file);
    await this.audit.record(user, 'file.download', 'survey', file.surveyId ?? '', { fileId: file.id, name: file.name });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
    res.setHeader('X-Content-SHA256', file.sha256);
    res.send(data);
  }
}

/** Express routes of JobsController (mounted by src/http/app.ts). */
export function jobsControllerRoutes(r: Router, c: JobsController, kit: RouteKit) {
  r.post(
    '/api/surveys/:id/jobs/export',
    ...kit.route({ controller: 'JobsController', handler: 'export', method: 'post' }, (req, res) =>
      c.export(req.user as AuthUser, req.params.id, req.body, res),
    ),
  );
  r.post(
    '/api/surveys/:id/jobs/qa',
    ...kit.route(
      { controller: 'JobsController', handler: 'qa', method: 'post', roles: [...CAN_EDIT], throttle: { limit: 30, ttl: 60_000 } },
      (req, res) => c.qa(req.user as AuthUser, req.params.id, req.body, res),
    ),
  );
  r.post(
    '/api/surveys/:id/jobs/ai',
    ...kit.route(
      {
        controller: 'JobsController',
        handler: 'ai',
        method: 'post',
        roles: [...CAN_EDIT],
        throttle: { limit: 20, ttl: 60_000 },
        upload: upload(),
      },
      (req, res) => c.ai(req.user as AuthUser, req.params.id, req.body, res, req.file as unknown as UploadedFile),
    ),
  );
  r.get(
    '/api/surveys/:id/jobs',
    ...kit.route({ controller: 'JobsController', handler: 'list', method: 'get' }, (req) =>
      c.list(req.user as AuthUser, req.params.id, req.query.type as string),
    ),
  );
  r.get(
    '/api/jobs/:id',
    ...kit.route({ controller: 'JobsController', handler: 'get', method: 'get' }, (req) => c.get(req.user as AuthUser, req.params.id)),
  );
  r.post(
    '/api/jobs/:id/cancel',
    ...kit.route({ controller: 'JobsController', handler: 'cancel', method: 'post' }, (req) =>
      c.cancel(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/files/:id',
    ...kit.route({ controller: 'JobsController', handler: 'download', method: 'get', raw: true }, (req, res) =>
      c.download(req.user as AuthUser, req.params.id, res),
    ),
  );
}
