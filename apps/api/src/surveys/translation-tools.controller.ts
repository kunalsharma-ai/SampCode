import { HttpException, NotFoundException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { buildTranslationMemory, memoryMatches, translationQa, type GlossaryTerm } from '@zapx/logic-engine';
import { LANGUAGE_TAG, parsePresentation, parseSurveyDefinition, type Presentation } from '@zapx/survey-schema';
import { parseBody } from '../common/validation';
import { type AuditService } from '../common/audit.service';
import { type PrismaService } from '../common/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { type SurveysService } from './surveys.service';

const termSchema = z.object({
  language: z.string().regex(LANGUAGE_TAG),
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
  note: z.string().trim().max(500).optional(),
});
const languageBody = z.object({ language: z.string().regex(LANGUAGE_TAG) });

/** How many recent survey versions feed the translation memory. */
const MEMORY_VERSIONS = 400;

/**
 * Blueprint phase 2: the organization's glossary, translation memory (reviewed translations from
 * its other surveys) and per-language QA.
 */
export class TranslationToolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly surveys: SurveysService,
  ) {}

  glossary(user: AuthUser, language?: string) {
    return this.prisma.glossaryTerm.findMany({
      where: { tenantId: user.tenantId, ...(language ? { language } : {}) },
      orderBy: [{ language: 'asc' }, { source: 'asc' }],
      take: 2000,
    });
  }

  async addTerm(user: AuthUser, body: unknown) {
    const t = parseBody(termSchema, body);
    const term = await this.prisma.glossaryTerm.upsert({
      where: { tenantId_language_source: { tenantId: user.tenantId, language: t.language, source: t.source } },
      create: { tenantId: user.tenantId, ...t, createdById: user.id },
      update: { target: t.target, note: t.note ?? null },
    });
    await this.audit.record(user, 'glossary.set', 'glossary_term', term.id, t);
    return term;
  }

  async removeTerm(user: AuthUser, id: string) {
    const term = await this.prisma.glossaryTerm.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!term) throw new NotFoundException('Glossary term not found');
    await this.prisma.glossaryTerm.delete({ where: { id } });
    await this.audit.record(user, 'glossary.delete', 'glossary_term', id, { language: term.language, source: term.source });
  }

  /** Per-language QA of the draft: blockers and reviewer warnings, with the glossary applied. */
  async qa(user: AuthUser, id: string, language: string) {
    const { def, pres } = await this.parsedDraft(user, id);
    if (!pres.languages.some((l) => l.tag === language)) throw new NotFoundException('Add the language first.');
    const glossary = await this.termsFor(user, language);
    const issues = translationQa(def, pres, language, glossary);
    return {
      language,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      issues,
    };
  }

  /**
   * Fill missing or outdated texts with translations a person already approved for the same source
   * text in this organization's surveys. Reused texts keep their approved status.
   */
  async applyMemory(user: AuthUser, id: string, body: unknown) {
    const { language } = parseBody(languageBody, body);
    const draft = await this.surveys.draft(user, id);
    const { def, pres } = this.parse(draft.definition, draft.presentation);
    if (!pres.languages.some((l) => l.tag === language)) throw new NotFoundException('Add the language first.');
    const memory = buildTranslationMemory(await this.approvedEntries(user, language, draft.id));
    const matches = memoryMatches(def, pres, language, memory);
    const saved = await this.prisma.$transaction(async (tx) => {
      // In a MongoDB transaction a concurrent update of this version makes the update below
      // conflict, and the transaction runs again on the fresh document (PostgreSQL used FOR UPDATE).
      const fresh = await tx.surveyVersion.findUniqueOrThrow({ where: { id: draft.id } });
      const latest = parsePresentation(fresh.presentation);
      const next: Presentation = latest.ok ? latest.presentation : pres;
      const target = next.languages.find((l) => l.tag === language);
      if (!target) throw new NotFoundException('The language was removed.');
      for (const [key, v] of Object.entries(matches)) target.texts[key] = { ...v, status: 'reviewed' };
      return tx.surveyVersion.update({ where: { id: draft.id }, data: { presentation: next as unknown as Prisma.InputJsonValue } });
    });
    await this.audit.record(user, 'survey.translate.memory', 'survey', id, {
      language,
      reused: Object.keys(matches).length,
      memorySize: memory.size,
    });
    return {
      reused: Object.keys(matches).length,
      memorySize: memory.size,
      version: saved,
      check: this.surveys.check(saved.definition, saved.presentation),
    };
  }

  termsFor(user: AuthUser, language: string): Promise<GlossaryTerm[]> {
    return this.prisma.glossaryTerm
      .findMany({ where: { tenantId: user.tenantId, language }, select: { source: true, target: true, note: true } })
      .then((rows) => rows.map((r) => ({ source: r.source, target: r.target, note: r.note ?? undefined })));
  }

  /** Reviewed translations into one language from the organization's recent survey versions. */
  private async approvedEntries(user: AuthUser, language: string, excludeVersionId: string) {
    const versions = await this.prisma.surveyVersion.findMany({
      where: { survey: { tenantId: user.tenantId }, id: { not: excludeVersionId } },
      orderBy: { updatedAt: 'desc' },
      take: MEMORY_VERSIONS,
      select: { presentation: true },
    });
    const out: Array<{ source: string; text: string }> = [];
    for (const v of versions) {
      const p = parsePresentation(v.presentation);
      if (!p.ok) continue;
      const lang = p.presentation.languages.find((l) => l.tag === language);
      for (const e of Object.values(lang?.texts ?? {})) if (e.status === 'reviewed') out.push({ source: e.source, text: e.text });
    }
    return out;
  }

  private async parsedDraft(user: AuthUser, id: string) {
    const draft = await this.surveys.draft(user, id);
    return this.parse(draft.definition, draft.presentation);
  }

  private parse(definition: unknown, presentation: unknown) {
    const def = parseSurveyDefinition(definition);
    const pres = parsePresentation(presentation);
    if (!def.ok || !pres.ok) throw new HttpException('Fix the draft first.', 422);
    return { def: def.definition, pres: pres.presentation };
  }
}

/** Express routes of TranslationToolsController (mounted by src/http/app.ts). */
export function translationToolsControllerRoutes(r: Router, c: TranslationToolsController, kit: RouteKit) {
  r.get(
    '/api/glossary',
    ...kit.route({ controller: 'TranslationToolsController', handler: 'glossary', method: 'get' }, (req) =>
      c.glossary(req.user as AuthUser, req.query.language as string),
    ),
  );
  r.post(
    '/api/glossary',
    ...kit.route({ controller: 'TranslationToolsController', handler: 'addTerm', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.addTerm(req.user as AuthUser, req.body),
    ),
  );
  r.delete(
    '/api/glossary/:id',
    ...kit.route(
      { controller: 'TranslationToolsController', handler: 'removeTerm', method: 'delete', status: 204, roles: [...CAN_EDIT] },
      (req) => c.removeTerm(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/translation-qa',
    ...kit.route({ controller: 'TranslationToolsController', handler: 'qa', method: 'get' }, (req) =>
      c.qa(req.user as AuthUser, req.params.id, req.query.language as string),
    ),
  );
  r.post(
    '/api/surveys/:id/translation-memory',
    ...kit.route({ controller: 'TranslationToolsController', handler: 'applyMemory', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.applyMemory(req.user as AuthUser, req.params.id, req.body),
    ),
  );
}
