import { BadRequestException, HttpException, UnprocessableEntityException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Response as ExpressResponse } from 'express';
import { z } from 'zod';
import { parseSurveyDefinition } from '@zapx/survey-schema';
import { config } from '../config';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type SurveysService } from '../surveys/surveys.service';
import { type ChangeSetsService } from './changesets.service';
import { type ProposeService } from '../ai/propose.service';
import { type AiGateway } from '../ai/ai-gateway';
import { notConfigured } from '../ai/claude.provider';
import { AiError } from '../ai/ai-provider';
import { classifyFile, toAiDocument, type UploadedFile } from '../imports/documents';
import { buildTemplateWorkbook, importTemplateRows, parseCsv, readXlsxTable } from '../imports/template-import';

const proposeSchema = z.object({ instruction: z.string().max(20000).default('') });
const manualSchema = z.object({ title: z.string().min(1).max(200).default('Pasted definition'), definition: z.unknown() });

const upload = () => ({ field: 'file', limits: { fileSize: config().UPLOAD_MAX_MB * 1024 * 1024, files: 1, fields: 10 } });

function aiHttpError(err: unknown): never {
  if (err instanceof AiError) throw new HttpException({ message: err.message, code: err.code }, err.status);
  throw err;
}

export class ChangeSetsController {
  constructor(
    private readonly changeSets: ChangeSetsService,
    private readonly surveys: SurveysService,
    private readonly proposer: ProposeService,
    private readonly gateway: AiGateway,
  ) {}

  aiStatus(user: AuthUser) {
    return this.gateway.status(user.tenantId);
  }

  async template(res: ExpressResponse) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="zapx-questionnaire-template.xlsx"');
    res.send(await buildTemplateWorkbook());
  }

  /**
   * AI Survey Architect: build or edit the draft from an instruction (typed or dictated) and an
   * optional questionnaire file. Returns a change set; the draft is not touched.
   */
  async propose(user: AuthUser, id: string, body: unknown, file?: UploadedFile) {
    const { instruction } = parseBody(proposeSchema, body ?? {});
    if (!instruction.trim() && !file) throw new BadRequestException('Describe what to build or change, or attach a questionnaire.');
    if (!this.proposer.configured) aiHttpError(notConfigured());
    const documents = [];
    if (file) {
      const kind = classifyFile(file);
      if (kind === 'xlsx') throw new BadRequestException('Excel files are imported with the template importer. Use Import file instead.');
      documents.push(await toAiDocument(file, kind));
    }
    return this.proposer.propose(user, id, { instruction, documents, fileName: file?.originalname }).catch(aiHttpError);
  }

  /**
   * Import a questionnaire file. The SampCode template (XLSX/CSV) is imported deterministically;
   * Word, PDF and text questionnaires are read by the AI architect.
   */
  async import(user: AuthUser, id: string, body: unknown, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a file.');
    const kind = classifyFile(file);
    if (kind === 'xlsx' || kind === 'csv') {
      const survey = await this.surveys.getSurvey(user, id);
      const table =
        kind === 'xlsx'
          ? await readXlsxTable(file.buffer).catch(() => {
              throw new BadRequestException('The Excel file could not be read.');
            })
          : parseCsv(file.buffer.toString('utf8'));
      const result = importTemplateRows(table, survey.name);
      if (!result.definition) {
        throw new UnprocessableEntityException({ message: 'The file could not be imported', errors: result.errors, rows: result.rows });
      }
      return this.changeSets.create(user, id, {
        source: 'IMPORT',
        title: `Import ${file.originalname}`,
        sourceFileName: file.originalname,
        proposed: result.definition,
        assumptions: result.assumptions,
        confidence: { overall: result.confidence, rows: result.rows },
        producer: 'zapx-template-v1',
      });
    }
    return this.propose(
      user,
      id,
      {
        instruction:
          parseBody(proposeSchema, body ?? {}).instruction || 'Program this questionnaire as a new survey, replacing the current draft.',
      },
      file,
    );
  }

  /** Propose a pasted definition (e.g. from another tool) for review like any other change. */
  async manual(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(manualSchema, body);
    const parsed = parseSurveyDefinition(input.definition);
    if (!parsed.ok) throw new BadRequestException({ message: 'The survey definition is not valid', issues: parsed.issues });
    return this.changeSets.create(user, id, { source: 'MANUAL', title: input.title, proposed: parsed.definition, producer: 'manual' });
  }

  list(user: AuthUser, id: string) {
    return this.changeSets.list(user, id);
  }

  get(user: AuthUser, id: string) {
    return this.changeSets.get(user, id);
  }

  apply(user: AuthUser, id: string) {
    return this.changeSets.apply(user, id);
  }

  reject(user: AuthUser, id: string) {
    return this.changeSets.reject(user, id);
  }
}

/** Express routes of ChangeSetsController (mounted by src/http/app.ts). */
export function changeSetsControllerRoutes(r: Router, c: ChangeSetsController, kit: RouteKit) {
  r.get(
    '/api/ai/status',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'aiStatus', method: 'get' }, (req) => c.aiStatus(req.user as AuthUser)),
  );
  r.get(
    '/api/imports/template.xlsx',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'template', method: 'get', raw: true }, (req, res) => c.template(res)),
  );
  r.post(
    '/api/surveys/:id/ai/propose',
    ...kit.route(
      {
        controller: 'ChangeSetsController',
        handler: 'propose',
        method: 'post',
        roles: [...CAN_EDIT],
        throttle: { limit: 20, ttl: 60_000 },
        upload: upload(),
      },
      (req) => c.propose(req.user as AuthUser, req.params.id, req.body, req.file as unknown as UploadedFile),
    ),
  );
  r.post(
    '/api/surveys/:id/import',
    ...kit.route(
      {
        controller: 'ChangeSetsController',
        handler: 'import',
        method: 'post',
        roles: [...CAN_EDIT],
        throttle: { limit: 30, ttl: 60_000 },
        upload: upload(),
      },
      (req) => c.import(req.user as AuthUser, req.params.id, req.body, req.file as unknown as UploadedFile),
    ),
  );
  r.post(
    '/api/surveys/:id/changesets',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'manual', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.manual(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/surveys/:id/changesets',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'list', method: 'get' }, (req) =>
      c.list(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/changesets/:id',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'get', method: 'get' }, (req) =>
      c.get(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/changesets/:id/apply',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'apply', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.apply(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/changesets/:id/reject',
    ...kit.route({ controller: 'ChangeSetsController', handler: 'reject', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.reject(req.user as AuthUser, req.params.id),
    ),
  );
}
