import { BadRequestException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';

import type { UploadedFile } from '../imports/documents';
import { parseBody } from '../common/validation';
import { isFirstRead, sendBytes } from '../common/send-bytes';
import { config } from '../config';
import { type InterviewService } from '../interview/interview.service';
import { type CaptureService, PHOTO_MAX_MB } from './capture.service';
import { type JobsService, presentJob } from '../jobs/jobs.service';
import { type TranscriptionService } from './transcription.service';

const maxBytes = () => Math.max(PHOTO_MAX_MB, config().CAPTURE_MAX_MB) * 1024 * 1024;

const deviceUploadSchema = z.object({
  clientId: z.string().uuid(),
  surveyId: z.string().min(1).max(64),
  ref: z.string().min(1).max(64),
  kind: z.enum(['photo', 'audio']),
});

/** Photos and interview recordings (Milestone 12). */
const transcribeSchema = z.object({
  captureIds: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{10,64}$/))
    .max(200)
    .optional(),
});

export class CaptureController {
  constructor(
    private readonly captures: CaptureService,
    private readonly interview: InterviewService,
    private readonly jobs: JobsService,
    private readonly transcription: TranscriptionService,
  ) {}

  /** A respondent's photo answer. Access is by the interview's session token, like every respondent call. */
  respondentPhoto(token: string, body: { questionId?: unknown }, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a photo');
    if (typeof body?.questionId !== 'string') throw new BadRequestException('questionId is required');
    return this.interview.uploadPhoto(token, body.questionId, file.buffer);
  }

  /** The interviewer app uploads photos and recordings before the interview itself syncs. */
  device(user: AuthUser, body: unknown, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach the file');
    return this.captures.uploadFromDevice(user, parseBody(deviceUploadSchema, body), file.buffer);
  }

  /** Open a photo or recording. Private: never cached by shared caches, never embedded by other sites. */
  async open(user: AuthUser, id: string, req: Request, res: Response) {
    const { meta, data } = await this.captures.open(user, id, isFirstRead(req));
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    sendBytes(req, res, data);
  }

  summary(user: AuthUser, id: string) {
    return this.captures.countOf(user, id);
  }

  /**
   * Transcribe recordings in the background (Milestone 17): the ones named, or every recording of
   * the survey that has no transcript yet. Each recording is sent to the transcription provider.
   */
  async transcribe(user: AuthUser, id: string, body: unknown) {
    if (!this.transcription.current()) throw new BadRequestException('Transcription is not turned on for this installation.');
    const input = parseBody(transcribeSchema, body ?? {});
    const job = await this.jobs.enqueue(user, 'transcribe', id, input.captureIds?.length ? { captureIds: input.captureIds } : {});
    return presentJob(job);
  }

  /** Erase every photo and recording of the survey. Cannot be undone. */
  erase(user: AuthUser, id: string) {
    return this.captures.eraseSurvey(user, id);
  }
}

/** Express routes of CaptureController (mounted by src/http/app.ts). */
export function captureControllerRoutes(r: Router, c: CaptureController, kit: RouteKit) {
  r.post(
    '/api/public/r/:token/captures',
    ...kit.route(
      {
        controller: 'CaptureController',
        handler: 'respondentPhoto',
        method: 'post',
        status: 200,
        public: true,
        throttle: { limit: 20, ttl: 60_000 },
        upload: { field: 'file', ...{ limits: { fileSize: PHOTO_MAX_MB * 1024 * 1024, files: 1, fields: 3 } } },
      },
      (req) => c.respondentPhoto(req.params.token, req.body as unknown as { questionId?: unknown }, req.file as unknown as UploadedFile),
    ),
  );
  r.post(
    '/api/capi/captures',
    ...kit.route(
      {
        controller: 'CaptureController',
        handler: 'device',
        method: 'post',
        status: 200,
        roles: ['INTERVIEWER'],
        throttle: { limit: 120, ttl: 60_000 },
        upload: { field: 'file', ...{ limits: { fileSize: maxBytes(), files: 1, fields: 6 } } },
      },
      (req) => c.device(req.user as AuthUser, req.body, req.file as unknown as UploadedFile),
    ),
  );
  r.get(
    '/api/captures/:id',
    ...kit.route({ controller: 'CaptureController', handler: 'open', method: 'get', throttle: false, raw: true }, (req, res) =>
      c.open(req.user as AuthUser, req.params.id, req, res),
    ),
  );
  r.get(
    '/api/surveys/:id/captures',
    ...kit.route({ controller: 'CaptureController', handler: 'summary', method: 'get' }, (req) =>
      c.summary(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/captures/transcribe',
    ...kit.route(
      { controller: 'CaptureController', handler: 'transcribe', method: 'post', status: 202, roles: ['ADMIN', 'PROGRAMMER'] },
      (req) => c.transcribe(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/captures/erase',
    ...kit.route({ controller: 'CaptureController', handler: 'erase', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.erase(req.user as AuthUser, req.params.id),
    ),
  );
}
