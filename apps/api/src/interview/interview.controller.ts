import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';

import { parseBody } from '../common/validation';
import { type InterviewService } from './interview.service';
import { config } from '../config';

const signalsSchema = z.object({
  hp: z.boolean().optional(),
  interactions: z.number().int().min(0).max(1_000_000).optional(),
  pasted: z.array(z.string().max(64)).max(100).optional(),
});

const answersSchema = z.object({
  pageId: z.string().min(1).max(64),
  answers: z.record(z.string().max(64), z.unknown()).refine((a) => Object.keys(a).length <= 500, 'Too many answers'),
  signals: signalsSchema.optional(),
});

const clientSchema = z.object({
  touch: z.boolean().optional(),
  screenShortSide: z.number().min(0).max(20000).optional(),
  automation: z.boolean().optional(),
  traits: z
    .record(z.string().max(20), z.union([z.string().max(100), z.number(), z.boolean()]))
    .refine((t) => Object.keys(t).length <= 20, 'Too many traits')
    .optional(),
});
const languageSchema = z.object({ language: z.string().min(2).max(35) });

/** Respondent-facing endpoints. No login: access is by signed link and an unguessable session token. */
export class InterviewController {
  constructor(private readonly interview: InterviewService) {}

  start(
    surveyId: string,
    body: unknown,
    ip: string,
    headers: Record<string, string | string[] | undefined>,
    userAgent?: string,
    acceptLanguage?: string,
  ) {
    const geoHeader = config().GEO_COUNTRY_HEADER;
    const geo = geoHeader ? headers[geoHeader] : undefined;
    const b = (body && typeof body === 'object' ? body : {}) as { query?: unknown; client?: unknown };
    const query = (b.query && typeof b.query === 'object' ? b.query : {}) as Record<string, unknown>;
    const client = clientSchema.safeParse(b.client ?? {});
    return this.interview.start(surveyId, query, {
      userAgent,
      ip,
      acceptLanguage: acceptLanguage?.slice(0, 200),
      client: client.success ? client.data : {},
      geoCountry: typeof geo === 'string' ? geo.slice(0, 2) : undefined,
    });
  }

  language(token: string, body: unknown) {
    return this.interview.setLanguage(token, parseBody(languageSchema, body).language);
  }

  state(token: string) {
    return this.interview.state(token);
  }

  submit(token: string, body: unknown) {
    const input = parseBody(answersSchema, body);
    return this.interview.submit(token, input.pageId, input.answers, input.signals);
  }

  back(token: string) {
    return this.interview.back(token);
  }
}

/** Express routes of InterviewController (mounted by src/http/app.ts). */
export function interviewControllerRoutes(r: Router, c: InterviewController, kit: RouteKit) {
  r.post(
    '/api/public/s/:surveyId/start',
    ...kit.route(
      {
        controller: 'InterviewController',
        handler: 'start',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 30, ttl: 60_000 },
      },
      (req) =>
        c.start(
          req.params.surveyId,
          req.body,
          req.ip as unknown as string,
          req.headers as unknown as Record<string, string | string[] | undefined>,
          req.headers['user-agent'] as unknown as string,
          req.headers['accept-language'] as unknown as string,
        ),
    ),
  );
  r.post(
    '/api/public/r/:token/language',
    ...kit.route(
      {
        controller: 'InterviewController',
        handler: 'language',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 120, ttl: 60_000 },
      },
      (req) => c.language(req.params.token, req.body),
    ),
  );
  r.get(
    '/api/public/r/:token',
    ...kit.route(
      { controller: 'InterviewController', handler: 'state', method: 'get', public: true, throttle: { limit: 120, ttl: 60_000 } },
      (req) => c.state(req.params.token),
    ),
  );
  r.post(
    '/api/public/r/:token/answers',
    ...kit.route(
      {
        controller: 'InterviewController',
        handler: 'submit',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 120, ttl: 60_000 },
      },
      (req) => c.submit(req.params.token, req.body),
    ),
  );
  r.post(
    '/api/public/r/:token/back',
    ...kit.route(
      {
        controller: 'InterviewController',
        handler: 'back',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 120, ttl: 60_000 },
      },
      (req) => c.back(req.params.token),
    ),
  );
}
