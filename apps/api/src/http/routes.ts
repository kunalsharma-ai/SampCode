/**
 * How a route is declared. Each controller file ends with a `...Routes(router, controller, kit)` function
 * that registers its routes on the Express router with `kit.route(options, handler)`, which returns the
 * middleware chain for that route, in this order:
 *
 *   rate limit -> sign-in and role check (unless public) -> extra guards -> file upload -> handler -> answer
 *
 * The handler returns the answer: an object or array is sent as JSON, a string as text, nothing as an
 * empty body, with `status` (default 201 for POST, 200 otherwise). A handler declared `raw` writes the
 * response itself (files, redirects, XML).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import type { AuthUser, RoleName } from '../auth/auth.types';
import type { Token } from '../container';
import type { Entitlements } from '../super-admin/features';
import { BadRequestException, PayloadTooLargeException } from './errors';
import { throttle, DEFAULT_THROTTLE, type ThrottleLimit, type ThrottleStore } from './throttle';

/** A request after the API's middleware: the signed-in member, their entitlements, an uploaded file. */
export type ApiRequest = Request & {
  /** Path parameters (no route uses a wildcard, so each is one string). */
  params: Record<string, string>;
  user?: AuthUser;
  entitlements?: Entitlements;
  file?: { originalname: string; mimetype: string; size: number; buffer: Buffer };
  rawBody?: Buffer;
};

/** A check that runs after sign-in (for example the SCIM token check); throw to refuse. */
export interface RequestGuard {
  canActivate(req: ApiRequest): Promise<boolean> | boolean;
}

export interface RouteOptions {
  /** Controller and handler name: the rate-limit key and the super-admin gate use them. */
  controller: string;
  handler: string;
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Status of a successful answer (default 201 for POST, 200 otherwise). */
  status?: number;
  /** No sign-in needed (respondent, login and webhook routes). */
  public?: boolean;
  /** Only these roles. Interviewers reach only routes that list them. */
  roles?: RoleName[];
  /** This route's own rate limit, or false for none. Default: DEFAULT_THROTTLE. */
  throttle?: ThrottleLimit | false;
  /** Accept one multipart file in this field (kept in memory, see multer limits). */
  upload?: { field: string; limits?: multer.Options['limits'] };
  guards?: RequestGuard[];
  /** Headers set on a successful answer. */
  headers?: Array<[string, string]>;
  /** The handler writes the response itself. */
  raw?: boolean;
  /** Answers errors of this route in its own format (SCIM). */
  onError?: (err: unknown, req: ApiRequest, res: Response) => void;
}

export type Handler = (req: ApiRequest, res: Response) => unknown;

/** The sign-in check the kit runs for routes that are not public (AuthGuard). */
export interface Authenticator {
  check(req: ApiRequest, route: { public?: boolean; roles?: RoleName[]; controller: string }): Promise<void>;
}

export interface RouteKit {
  route(options: RouteOptions, handler: Handler): RequestHandler[];
  /** A service from the container (for route guards such as ScimGuard). */
  get<T>(token: Token<T>): T;
}

/** A whole-number path parameter, or 400 (as NestJS's ParseIntPipe answered). */
export function intParam(value: unknown): number {
  const s = String(value ?? '');
  if (!/^-?\d+$/.test(s)) throw new BadRequestException('Validation failed (numeric string is expected)');
  return Number(s);
}

/** Turns multer's errors into the answers clients expect (413 for a file that is too large). */
function uploadError(e: unknown): unknown {
  if (!(e instanceof multer.MulterError)) return e;
  const messages: Record<string, string> = {
    LIMIT_PART_COUNT: 'Too many parts',
    LIMIT_FILE_COUNT: 'Too many files',
    LIMIT_FIELD_KEY: 'Field name too long',
    LIMIT_FIELD_VALUE: 'Field value too long',
    LIMIT_FIELD_COUNT: 'Too many fields',
    LIMIT_UNEXPECTED_FILE: 'Unexpected field',
  };
  if (e.code === 'LIMIT_FILE_SIZE') return new PayloadTooLargeException('File too large');
  return new BadRequestException(messages[e.code] ?? e.message);
}

/** Sends a handler's return value. */
export function reply(res: Response, status: number, value: unknown) {
  if (res.headersSent) return;
  res.status(status);
  if (value === undefined || value === null) res.send();
  else if (typeof value === 'object') res.json(value);
  else res.send(String(value));
}

export function createRouteKit(deps: { auth: Authenticator; throttleStore: ThrottleStore; get: <T>(token: Token<T>) => T }): RouteKit {
  return {
    get: deps.get,
    route(o, handler) {
      const chain: RequestHandler[] = [];
      const name = `${o.controller}.${o.handler}`;
      const fail = (err: unknown, req: ApiRequest, res: Response, next: NextFunction) => (o.onError ? o.onError(err, req, res) : next(err));
      const step =
        (fn: (req: ApiRequest, res: Response) => Promise<unknown> | unknown): RequestHandler =>
        (req, res, next) => {
          Promise.resolve()
            .then(() => fn(req as ApiRequest, res))
            .then(
              () => next(),
              (err: unknown) => fail(err, req as ApiRequest, res, next),
            );
        };
      if (o.throttle !== false)
        chain.push(step((req, res) => throttle(deps.throttleStore, name, o.throttle || DEFAULT_THROTTLE, req, res)));
      chain.push(step((req) => deps.auth.check(req, { public: o.public, roles: o.roles, controller: o.controller })));
      for (const g of o.guards ?? []) chain.push(step(async (req) => void (await g.canActivate(req))));
      if (o.upload) {
        const upload = multer({ storage: multer.memoryStorage(), limits: o.upload.limits }).single(o.upload.field);
        chain.push((req, res, next) =>
          upload(req, res, (err?: unknown) => (err ? fail(uploadError(err), req as ApiRequest, res, next) : next())),
        );
      }
      const status = o.status ?? (o.method === 'post' ? 201 : 200);
      chain.push((req, res, next) => {
        Promise.resolve()
          .then(() => handler(req as ApiRequest, res))
          .then(
            (value) => {
              if (o.raw) return;
              for (const [k, v] of o.headers ?? []) if (!res.headersSent) res.setHeader(k, v);
              // A handler that set its own status (res.status(202)) keeps it.
              reply(res, res.statusCode !== 200 ? res.statusCode : status, value);
            },
            (err: unknown) => fail(err, req as ApiRequest, res, next),
          );
      });
      return chain;
    },
  };
}
