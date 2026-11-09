import { HttpException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Prisma } from '@zapx/db';
import { runTestSuite } from '@zapx/logic-engine';
import { parseSurveyDefinition, qaTestCaseSchema, type QaTestCase } from '@zapx/survey-schema';
import { parseBody } from '../common/validation';
import { type AuditService } from '../common/audit.service';
import { type PrismaService } from '../common/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type SurveysService } from '../surveys/surveys.service';

/** At most this many cases per survey. */
const MAX_CASES = 500;

/**
 * Blueprint phase 2: saved QA test cases, run against the draft as a regression suite (Programmer
 * debugger "Save as test case", QA lab "Run test cases").
 */
export class TestCasesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly surveys: SurveysService,
  ) {}

  async list(user: AuthUser, id: string) {
    await this.surveys.getSurvey(user, id);
    const rows = await this.prisma.qaTestCase.findMany({ where: { surveyId: id, tenantId: user.tenantId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ id: r.id, updatedAt: r.updatedAt, ...(r.data as object) }));
  }

  async create(user: AuthUser, id: string, body: unknown) {
    await this.surveys.getSurvey(user, id);
    const tc = parseBody(qaTestCaseSchema, body);
    if ((await this.prisma.qaTestCase.count({ where: { surveyId: id } })) >= MAX_CASES)
      throw new HttpException(`A survey can have at most ${MAX_CASES} test cases.`, 422);
    const row = await this.prisma.qaTestCase.create({
      data: { tenantId: user.tenantId, surveyId: id, name: tc.name, data: tc as unknown as Prisma.InputJsonValue, createdById: user.id },
    });
    await this.audit.record(user, 'survey.test_case.create', 'survey', id, { testCase: row.id, name: tc.name });
    return { id: row.id, ...tc };
  }

  async update(user: AuthUser, id: string, caseId: string, body: unknown) {
    await this.find(user, id, caseId);
    const tc = parseBody(qaTestCaseSchema, body);
    await this.prisma.qaTestCase.update({ where: { id: caseId }, data: { name: tc.name, data: tc as unknown as Prisma.InputJsonValue } });
    await this.audit.record(user, 'survey.test_case.update', 'survey', id, { testCase: caseId, name: tc.name });
    return { id: caseId, ...tc };
  }

  async remove(user: AuthUser, id: string, caseId: string) {
    const row = await this.find(user, id, caseId);
    await this.prisma.qaTestCase.delete({ where: { id: caseId } });
    await this.audit.record(user, 'survey.test_case.delete', 'survey', id, { testCase: caseId, name: row.name });
  }

  /** Run every saved case against the saved draft. */
  async run(user: AuthUser, id: string) {
    const draft = await this.surveys.draft(user, id);
    const def = parseSurveyDefinition(draft.definition);
    if (!def.ok) throw new HttpException('Fix the draft before running test cases.', 422);
    const rows = await this.prisma.qaTestCase.findMany({ where: { surveyId: id, tenantId: user.tenantId }, orderBy: { createdAt: 'asc' } });
    const cases: Array<{ id: string; tc: QaTestCase }> = [];
    for (const r of rows) {
      const p = qaTestCaseSchema.safeParse(r.data);
      if (p.success) cases.push({ id: r.id, tc: p.data });
    }
    const suite = runTestSuite(
      def.definition,
      cases.map((c) => c.tc),
    );
    await this.audit.record(user, 'survey.test_case.run', 'survey', id, {
      version: draft.version,
      passed: suite.passed,
      failed: suite.failed,
    });
    return {
      version: draft.version,
      ranAt: new Date().toISOString(),
      ...suite,
      results: suite.results.map((r, i) => ({ id: cases[i]!.id, ...r })),
    };
  }

  private async find(user: AuthUser, surveyId: string, caseId: string) {
    const row = await this.prisma.qaTestCase.findFirst({ where: { id: caseId, surveyId, tenantId: user.tenantId } });
    if (!row) throw new NotFoundException('Test case not found');
    return row;
  }
}

/** Express routes of TestCasesController (mounted by src/http/app.ts). */
export function testCasesControllerRoutes(r: Router, c: TestCasesController, kit: RouteKit) {
  r.get(
    '/api/surveys/:id/test-cases',
    ...kit.route({ controller: 'TestCasesController', handler: 'list', method: 'get' }, (req) =>
      c.list(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/test-cases',
    ...kit.route({ controller: 'TestCasesController', handler: 'create', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.create(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.put(
    '/api/surveys/:id/test-cases/:caseId',
    ...kit.route({ controller: 'TestCasesController', handler: 'update', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.update(req.user as AuthUser, req.params.id, req.params.caseId, req.body),
    ),
  );
  r.delete(
    '/api/surveys/:id/test-cases/:caseId',
    ...kit.route({ controller: 'TestCasesController', handler: 'remove', method: 'delete', status: 204, roles: [...CAN_EDIT] }, (req) =>
      c.remove(req.user as AuthUser, req.params.id, req.params.caseId),
    ),
  );
  r.post(
    '/api/surveys/:id/test-cases/run',
    ...kit.route({ controller: 'TestCasesController', handler: 'run', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.run(req.user as AuthUser, req.params.id),
    ),
  );
}
