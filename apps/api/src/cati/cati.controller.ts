import { BadRequestException } from '../http/errors';
import type { Router } from 'express';
import type { RouteKit } from '../http/routes';
import { z } from 'zod';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT } from '../auth/decorators';
import { parseCsv } from '../imports/template-import';
import type { UploadedFile } from '../imports/documents';
import { type CatiService, DISPOSITIONS, type CaseInput, type Disposition } from './cati.service';

const CALLERS = ['ADMIN', 'PROGRAMMER', 'INTERVIEWER'] as const;
const MAX_CASES = 20_000;

const casesSchema = z.object({
  maxAttempts: z.number().int().min(1).max(20).default(6),
  cases: z
    .array(
      z.object({
        code: z.string().max(64),
        phone: z.string().max(40),
        name: z.string().max(120).optional(),
        timeZone: z.string().max(64).optional(),
        data: z.record(z.string(), z.string()).optional(),
      }),
    )
    .min(1)
    .max(MAX_CASES),
});
const disposeSchema = z.object({
  disposition: z.enum(Object.keys(DISPOSITIONS) as [Disposition, ...Disposition[]]),
  note: z.string().max(1000).optional(),
  callbackAt: z.coerce.date().optional(),
  /** When the interviewer opened the case (for call length); clamped to the last 12 hours. */
  openedAt: z.coerce.date().optional(),
});

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;
const hoursSchema = z.union([
  z.object({ clear: z.literal(true) }),
  z.object({
    timeZone: z.string().max(64),
    from: z.string().regex(TIME, 'Use HH:MM'),
    until: z.string().regex(TIME, 'Use HH:MM'),
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  }),
]);
const dncSchema = z.object({ phones: z.array(z.string().max(40)).min(1).max(1000), note: z.string().max(200).optional() });

/** Numbers from a do-not-call CSV: the "phone" column when there is one, else the first column. */
export function phonesFromCsv(text: string): string[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, '')).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) throw new BadRequestException('The file is empty');
  const lower = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = lower.findIndex((h) => ['phone', 'phone_number', 'telephone', 'mobile', 'number'].includes(h));
  // A first row without a number in it is a header.
  const header = col >= 0 || (rows[0]![0] ?? '').replace(/[^0-9]/g, '').length < 6;
  const body = header ? rows.slice(1) : rows;
  if (body.length > 100_000) throw new BadRequestException('Upload at most 100,000 numbers at a time');
  return body.map((r) => r[Math.max(0, col)] ?? '');
}

/** Reads a call list CSV: columns id (or code), phone, optional name, and any other columns as sample data. */
export function casesFromCsv(text: string): CaseInput[] {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, '')).filter((r) => r.some((c) => c.trim()));
  if (!header) throw new BadRequestException('The file is empty');
  const cols = header.map((h) => h.trim());
  const lower = cols.map((h) => h.toLowerCase());
  const at = (...names: string[]) => lower.findIndex((h) => names.includes(h));
  const idCol = at('id', 'code', 'uid', 'respondent_id');
  const phoneCol = at('phone', 'phone_number', 'telephone', 'mobile');
  const nameCol = at('name', 'full_name');
  const tzCol = at('timezone', 'time_zone', 'tz');
  if (idCol < 0 || phoneCol < 0) throw new BadRequestException('The file needs an "id" column and a "phone" column');
  if (rows.length > MAX_CASES) throw new BadRequestException(`Upload at most ${MAX_CASES} rows at a time`);
  return rows.map((r) => {
    const data: Record<string, string> = {};
    cols.forEach((h, i) => {
      if (i !== idCol && i !== phoneCol && i !== nameCol && i !== tzCol && r[i] !== undefined && r[i] !== '') data[h] = r[i]!;
    });
    return {
      code: r[idCol] ?? '',
      phone: r[phoneCol] ?? '',
      name: nameCol >= 0 ? r[nameCol] : undefined,
      timeZone: tzCol >= 0 && r[tzCol] ? r[tzCol] : undefined,
      data,
    };
  });
}

/** CATI (Milestone 9): call lists for programmers, and the calling queue for interviewers. */
export class CatiController {
  constructor(private readonly cati: CatiService) {}

  // ---- Programmers ----

  add(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(casesSchema, body);
    return this.cati.addCases(user, id, input.cases, input.maxAttempts);
  }

  upload(user: AuthUser, id: string, body: { maxAttempts?: string }, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a CSV file');
    const maxAttempts = Math.min(20, Math.max(1, Number(body?.maxAttempts) || 6));
    return this.cati.addCases(user, id, casesFromCsv(file.buffer.toString('utf8')), maxAttempts);
  }

  summary(user: AuthUser, id: string) {
    return this.cati.summary(user, id);
  }

  list(user: AuthUser, id: string, status?: string) {
    if (status && !['PENDING', 'CALLBACK', 'IN_CALL', 'DONE', 'CLOSED'].includes(status)) throw new BadRequestException('Unknown status');
    return this.cati.listCases(user, id, status);
  }

  reopen(user: AuthUser, id: string) {
    return this.cati.reopen(user, id);
  }

  erase(user: AuthUser, id: string) {
    return this.cati.erasePhones(user, id);
  }

  // ---- Calling hours and the do-not-call list (Milestone 18) ----

  hours(user: AuthUser, id: string) {
    return this.cati.hours(user, id);
  }

  setHours(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(hoursSchema, body);
    return this.cati.setHours(user, id, 'clear' in input ? null : input);
  }

  dnc(user: AuthUser) {
    return this.cati.doNotCall(user);
  }

  addDnc(user: AuthUser, body: unknown) {
    const input = parseBody(dncSchema, body);
    return this.cati.addDoNotCall(user, input.phones, 'manual', input.note);
  }

  uploadDnc(user: AuthUser, file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a CSV file');
    return this.cati.addDoNotCall(user, phonesFromCsv(file.buffer.toString('utf8')), 'upload');
  }

  /** Taking a number off the list is an administrator's decision (the person may have asked twice). */
  removeDnc(user: AuthUser, id: string) {
    return this.cati.removeDoNotCall(user, id);
  }

  // ---- Interviewers (and admins or programmers who make calls) ----

  dispositions() {
    return Object.entries(DISPOSITIONS).map(([code, d]) => ({ code, label: d.label }));
  }

  surveys(user: AuthUser) {
    return this.cati.mySurveys(user);
  }

  async next(user: AuthUser, id: string) {
    return { case: await this.cati.next(user, id) };
  }

  interview(user: AuthUser, id: string) {
    return this.cati.interview(user, id);
  }

  dispose(user: AuthUser, id: string, body: unknown) {
    const input = parseBody(disposeSchema, body);
    const now = Date.now();
    const opened =
      input.openedAt && input.openedAt.getTime() <= now && now - input.openedAt.getTime() < 12 * 3_600_000 ? input.openedAt : new Date(now);
    return this.cati.dispose(user, id, input, opened);
  }

  release(user: AuthUser, id: string) {
    return this.cati.release(user, id);
  }
}

/** Express routes of CatiController (mounted by src/http/app.ts). */
export function catiControllerRoutes(r: Router, c: CatiController, kit: RouteKit) {
  r.post(
    '/api/surveys/:id/cati/cases',
    ...kit.route({ controller: 'CatiController', handler: 'add', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.add(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/surveys/:id/cati/cases/upload',
    ...kit.route(
      {
        controller: 'CatiController',
        handler: 'upload',
        method: 'post',
        roles: [...CAN_EDIT],
        upload: { field: 'file', ...{ limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } } },
      },
      (req) =>
        c.upload(req.user as AuthUser, req.params.id, req.body as unknown as { maxAttempts?: string }, req.file as unknown as UploadedFile),
    ),
  );
  r.get(
    '/api/surveys/:id/cati/summary',
    ...kit.route({ controller: 'CatiController', handler: 'summary', method: 'get', roles: ['ADMIN', 'PROGRAMMER', 'VIEWER'] }, (req) =>
      c.summary(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/cati/cases',
    ...kit.route({ controller: 'CatiController', handler: 'list', method: 'get', roles: ['ADMIN', 'PROGRAMMER', 'VIEWER'] }, (req) =>
      c.list(req.user as AuthUser, req.params.id, req.query.status as string),
    ),
  );
  r.post(
    '/api/cati/cases/:id/reopen',
    ...kit.route({ controller: 'CatiController', handler: 'reopen', method: 'post', roles: [...CAN_EDIT] }, (req) =>
      c.reopen(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/surveys/:id/cati/erase-phones',
    ...kit.route({ controller: 'CatiController', handler: 'erase', method: 'post', status: 200, roles: ['ADMIN'] }, (req) =>
      c.erase(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/surveys/:id/cati/hours',
    ...kit.route({ controller: 'CatiController', handler: 'hours', method: 'get', roles: ['ADMIN', 'PROGRAMMER', 'VIEWER'] }, (req) =>
      c.hours(req.user as AuthUser, req.params.id),
    ),
  );
  r.put(
    '/api/surveys/:id/cati/hours',
    ...kit.route({ controller: 'CatiController', handler: 'setHours', method: 'put', roles: [...CAN_EDIT] }, (req) =>
      c.setHours(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.get(
    '/api/cati/do-not-call',
    ...kit.route({ controller: 'CatiController', handler: 'dnc', method: 'get', roles: [...CAN_EDIT] }, (req) =>
      c.dnc(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/cati/do-not-call',
    ...kit.route({ controller: 'CatiController', handler: 'addDnc', method: 'post', status: 200, roles: [...CAN_EDIT] }, (req) =>
      c.addDnc(req.user as AuthUser, req.body),
    ),
  );
  r.post(
    '/api/cati/do-not-call/upload',
    ...kit.route(
      {
        controller: 'CatiController',
        handler: 'uploadDnc',
        method: 'post',
        status: 200,
        roles: [...CAN_EDIT],
        upload: { field: 'file', ...{ limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 } } },
      },
      (req) => c.uploadDnc(req.user as AuthUser, req.file as unknown as UploadedFile),
    ),
  );
  r.delete(
    '/api/cati/do-not-call/:id',
    ...kit.route({ controller: 'CatiController', handler: 'removeDnc', method: 'delete', status: 204, roles: ['ADMIN'] }, (req) =>
      c.removeDnc(req.user as AuthUser, req.params.id),
    ),
  );
  r.get(
    '/api/cati/dispositions',
    ...kit.route({ controller: 'CatiController', handler: 'dispositions', method: 'get', roles: [...CALLERS] }, () => c.dispositions()),
  );
  r.get(
    '/api/cati/surveys',
    ...kit.route({ controller: 'CatiController', handler: 'surveys', method: 'get', roles: [...CALLERS] }, (req) =>
      c.surveys(req.user as AuthUser),
    ),
  );
  r.post(
    '/api/cati/surveys/:id/next',
    ...kit.route({ controller: 'CatiController', handler: 'next', method: 'post', status: 200, roles: [...CALLERS] }, (req) =>
      c.next(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/cati/cases/:id/interview',
    ...kit.route({ controller: 'CatiController', handler: 'interview', method: 'post', status: 200, roles: [...CALLERS] }, (req) =>
      c.interview(req.user as AuthUser, req.params.id),
    ),
  );
  r.post(
    '/api/cati/cases/:id/disposition',
    ...kit.route({ controller: 'CatiController', handler: 'dispose', method: 'post', status: 200, roles: [...CALLERS] }, (req) =>
      c.dispose(req.user as AuthUser, req.params.id, req.body),
    ),
  );
  r.post(
    '/api/cati/cases/:id/release',
    ...kit.route({ controller: 'CatiController', handler: 'release', method: 'post', status: 204, roles: [...CALLERS] }, (req) =>
      c.release(req.user as AuthUser, req.params.id),
    ),
  );
}
