import { NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { type PrismaService } from '../common/prisma.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type SurveysService } from '../surveys/surveys.service';
import { type QaService } from './qa.service';

/** Upper bound for one run inside a request; up to MAX_QA_JOB_RESPONDENTS run as a background job. */
export const MAX_QA_RESPONDENTS = 2000;
export const MAX_QA_JOB_RESPONDENTS = 10000;

export const qaRunSchema = (max: number) =>
  z.object({
    respondents: z.number().int().min(1).max(max).default(500),
    seed: z.string().max(64).optional(),
    /** Test the editable draft (default) or the version respondents currently get. */
    target: z.enum(['draft', 'live']).default('draft'),
  });
const runSchema = qaRunSchema(MAX_QA_RESPONDENTS);

/**
 * QA Laboratory: simulate synthetic respondents through a version of the survey, using the same
 * logic engine as live interviews, and keep the report. Runs never create responses or touch quotas.
 */
export class QaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly surveys: SurveysService,
    private readonly qa: QaService,
  ) {}

  async run(user: AuthUser, id: string, body: unknown) {
    return this.qa.run(user, id, parseBody(runSchema, body ?? {}));
  }

  async list(user: AuthUser, id: string) {
    await this.surveys.getSurvey(user, id);
    return this.prisma.qaRun.findMany({
      where: { surveyId: id, tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, version: true, respondents: true, seed: true, passed: true, coverage: true, createdAt: true },
    });
  }

  async get(user: AuthUser, runId: string) {
    const run = await this.prisma.qaRun.findFirst({ where: { id: runId, tenantId: user.tenantId } });
    if (!run) throw new NotFoundException('QA run not found');
    await this.surveys.getSurvey(user, run.surveyId).catch(() => {
      throw new NotFoundException('QA run not found');
    });
    return run;
  }
}

/** Express routes of QaController (mounted by src/http/app.ts). */
export function qaControllerRoutes(r: Router, c: QaController, kit: RouteKit) {
  r.post(
    '/api/surveys/:id/qa/run',
    ...kit.route(
      { controller: 'QaController', handler: 'run', method: 'post', roles: [...CAN_EDIT], throttle: { limit: 30, ttl: 60_000 } },
      (req) => c.run(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/qa/runs',
    ...kit.route({ controller: 'QaController', handler: 'list', method: 'get' }, (req) => c.list(req.user as AuthUser, req.params.id)),
  );
  r.get(
    '/api/qa/runs/:runId',
    ...kit.route({ controller: 'QaController', handler: 'get', method: 'get' }, (req) => c.get(req.user as AuthUser, req.params.runId)),
  );
}
