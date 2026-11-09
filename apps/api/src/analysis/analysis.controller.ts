import { BadRequestException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type AnalysisService, filtersSchema, reportConfigSchema, weightingSchema } from './analysis.service';
import { type ResearchAssistantService, askSchema } from './research.service';

const READERS = ['ADMIN', 'PROGRAMMER', 'VIEWER'] as const;
const frequenciesSchema = z.object({
  filters: filtersSchema,
  weighting: weightingSchema,
  variables: z.array(z.string().max(100)).max(500).optional(),
});
const weightsSchema = z.object({ filters: filtersSchema, weighting: weightingSchema.unwrap() });
const crosstabSchema = z.object({
  filters: filtersSchema,
  weighting: weightingSchema,
  banner: z.string().max(100),
  stubs: z.array(z.string().max(100)).min(1).max(200),
  confidence: z.union([z.literal(0.9), z.literal(0.95), z.literal(0.99)]).default(0.95),
});
const reportSchema = z.object({ name: z.string().trim().min(1).max(120), config: reportConfigSchema });

/** Analysis and saved reports (Milestone 10). Viewers can run and download; programmers save. */
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly assistant: ResearchAssistantService,
  ) {}

  /** The tables the research assistant would read for these settings (no AI call). */
  async assistantTables(user: AuthUser, id: string, body: unknown) {
    const { question: _q, ...input } = parseBody(askSchema.extend({ question: z.string().max(2000).default('') }), body);
    const { total, weighted, tables } = await this.assistant.tables(user, id, input);
    return { total, weighted, tables };
  }

  /** Ask the research assistant a question about computed tables. */
  ask(user: AuthUser, id: string, body: unknown) {
    return this.assistant.ask(user, id, parseBody(askSchema, body));
  }

  variables(user: AuthUser, id: string) {
    return this.analysis.variables(user, id);
  }

  frequencies(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(frequenciesSchema, body ?? {});
    return this.analysis.frequencies(user, id, input.filters, input.variables, input.weighting);
  }

  /** Blueprint phase 5: run a dashboard of chart tiles without saving it. */
  dashboard(user: AuthUser, id: string, body: unknown) {
    const cfg = parseBody(reportConfigSchema, { ...((body ?? {}) as object), type: 'dashboard' });
    if (cfg.type !== 'dashboard') throw new BadRequestException('Not a dashboard');
    return this.analysis.dashboard(user, id, cfg);
  }

  crosstab(user: AuthUser, id: string, body: unknown) {
    return this.analysis.crosstabs(user, id, parseBody(crosstabSchema, body));
  }

  choice(user: AuthUser, id: string, questionId: string, body: unknown) {
    const input = parseBody(frequenciesSchema, body ?? {});
    return this.analysis.choice(user, id, questionId, input.filters, input.weighting);
  }

  eyeTracking(user: AuthUser, id: string, questionId: string, body: unknown) {
    const input = parseBody(frequenciesSchema, body ?? {});
    return this.analysis.eyeTracking(user, id, questionId, input.filters, input.weighting);
  }

  async design(user: AuthUser, id: string, questionId: string, res: ExpressResponse) {
    const csv = await this.analysis.choiceDesignCsv(user, id, questionId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${questionId.replace(/[^A-Za-z0-9_]/g, '')}-design.csv"`);
    res.send(csv);
  }

  weights(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(weightsSchema, body);
    return this.analysis.weights(user, id, input.filters, input.weighting);
  }

  list(user: AuthUser, id: string) {
    return this.analysis.listReports(user, id);
  }

  create(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(reportSchema, body);
    return this.analysis.saveReport(user, id, input.name, input.config);
  }

  get(user: AuthUser, id: string) {
    return this.analysis.report(user, id);
  }

  async update(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(reportSchema, body);
    const r = await this.analysis.report(user, id);
    return this.analysis.saveReport(user, r.surveyId, input.name, input.config, id);
  }

  remove(user: AuthUser, id: string) {
    return this.analysis.deleteReport(user, id);
  }

  async run(user: AuthUser, id: string) {
    const r = await this.analysis.report(user, id);
    return this.analysis.run(user, r.surveyId, reportConfigSchema.parse(r.config));
  }

  async export(user: AuthUser, id: string, res: ExpressResponse) {
    const file = await this.analysis.exportReport(user, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.send(file.data);
  }
}

/** Express routes of AnalysisController (mounted by src/http/app.ts). */
export function analysisControllerRoutes(r: Router, c: AnalysisController, kit: RouteKit) {
  r.post(
    '/api/surveys/:id/analysis/assistant/tables',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'assistantTables',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.assistantTables(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/assistant',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'ask',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 10, ttl: 60_000 },
      },
      (req) => c.ask(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/analysis/variables',
    ...kit.route(
      { controller: 'AnalysisController', handler: 'variables', method: 'get', roles: [...READERS], throttle: { limit: 60, ttl: 60_000 } },
      (req) => c.variables(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/frequencies',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'frequencies',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.frequencies(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/dashboard',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'dashboard',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.dashboard(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/crosstab',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'crosstab',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.crosstab(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/choice/:questionId',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'choice',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.choice(req.user as AuthUser, req.params.id, req.params.questionId, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/eyetracking/:questionId',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'eyeTracking',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.eyeTracking(req.user as AuthUser, req.params.id, req.params.questionId, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/analysis/choice/:questionId/design.csv',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'design',
        method: 'get',
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
        raw: true,
      },
      (req, res) => c.design(req.user as AuthUser, req.params.id, req.params.questionId, res),
    ),
  );
  r.post(
    '/api/surveys/:id/analysis/weights',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'weights',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.weights(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/reports',
    ...kit.route(
      { controller: 'AnalysisController', handler: 'list', method: 'get', roles: [...READERS], throttle: { limit: 60, ttl: 60_000 } },
      (req) => c.list(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/reports',
    ...kit.route(
      { controller: 'AnalysisController', handler: 'create', method: 'post', roles: [...CAN_EDIT], throttle: { limit: 60, ttl: 60_000 } },
      (req) => c.create(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/reports/:id',
    ...kit.route(
      { controller: 'AnalysisController', handler: 'get', method: 'get', roles: [...READERS], throttle: { limit: 60, ttl: 60_000 } },
      (req) => c.get(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/reports/:id',
    ...kit.route(
      { controller: 'AnalysisController', handler: 'update', method: 'put', roles: [...CAN_EDIT], throttle: { limit: 60, ttl: 60_000 } },
      (req) => c.update(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.delete(
    '/api/reports/:id',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'remove',
        method: 'delete',
        status: 204,
        roles: [...CAN_EDIT],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.remove(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/reports/:id/run',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'run',
        method: 'post',
        status: 200,
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
      },
      (req) => c.run(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/reports/:id/export.xlsx',
    ...kit.route(
      {
        controller: 'AnalysisController',
        handler: 'export',
        method: 'get',
        roles: [...READERS],
        throttle: { limit: 60, ttl: 60_000 },
        raw: true,
      },
      (req, res) => c.export(req.user as AuthUser, req.params.id, res),
    ),
  );
}
