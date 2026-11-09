/**
 * The API as an Express app (ADR 0041). createApp builds the services (src/container.ts), mounts every
 * controller's routes under /api, and adds the shared middleware:
 *
 *   cookies -> JSON body (keeps the raw bytes for signed webhooks) -> edge trust -> security headers
 *   -> routes -> 404 -> error answer
 *
 * main.ts listens on API_PORT; worker.ts only runs init (no HTTP); the tests use getHttpServer().
 */
import { createServer, type Server } from 'node:http';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { edgeTrust, securityHeaders } from '../bootstrap';
import { DbThrottlerStorage, throttleStore } from '../common/db-throttler-storage';
import { PrismaService } from '../common/prisma.service';
import { config } from '../config';
import { Container, PROVIDERS, ROUTES, type Token } from '../container';
import { HttpException, statusTitle } from './errors';
import { Logger } from './logger';
import { createRouteKit } from './routes';
import { MemoryThrottleStore } from './throttle';

export interface ApiApp {
  /** The Express app itself. */
  express: express.Express;
  /** A service or controller from the container. */
  get<T>(token: Token<T>): T;
  /** Runs the start hooks (connect, load settings, start workers). */
  init(): Promise<ApiApp>;
  /** Runs the stop hooks and closes the HTTP server if it listens. */
  close(): Promise<void>;
  /** The HTTP server (created on first call, not listening until listen). */
  getHttpServer(): Server;
  listen(port: number): Promise<Server>;
}

export interface CreateAppOptions {
  /** Replace services with given values, e.g. [[AiProvider, fakeAi]] in tests. */
  overrides?: Array<[Token, unknown]>;
}

type Hooks = { onModuleInit?(): unknown; onApplicationBootstrap?(): unknown; onModuleDestroy?(): unknown };

const log = new Logger('ExceptionsHandler');

/** Turns any error into the answer: HttpException as it says, body-parser errors as 400/413, anything else 500. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpException) {
    res.status(err.getStatus()).json(err.toBody());
    return;
  }
  const status = (err as { status?: unknown; type?: unknown }).status;
  if (typeof status === 'number' && status >= 400 && status < 500 && typeof (err as { type?: unknown }).type === 'string') {
    // body-parser: malformed JSON, too large, unsupported charset.
    res
      .status(status)
      .json({ message: status === 400 ? 'Invalid JSON body' : statusTitle(status), error: statusTitle(status), statusCode: status });
    return;
  }
  log.error(`${req.method} ${req.originalUrl}: ${(err as Error)?.stack ?? String(err)}`);
  res.status(500).json({ statusCode: 500, message: 'Internal server error' });
}

export function createApp(options: CreateAppOptions = {}): ApiApp {
  const container = new Container(options.overrides);
  const get = container.get;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config().TRUST_PROXY_HOPS);
  app.use(cookieParser());
  // SCIM clients send application/scim+json (Milestone 8), so the parser reads both types (100 kB limit).
  // The Stripe webhook (Milestone 13) and SampAudience events are verified over the exact bytes received,
  // so those are kept for these paths.
  app.use(
    express.json({
      type: ['application/json', 'application/scim+json'],
      verify: (req: { url?: string; rawBody?: Buffer }, _res: unknown, buf: Buffer) => {
        if (req.url?.startsWith('/api/billing/webhook') || req.url?.startsWith('/api/v1/sampleon/')) req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));
  app.use((req, _res, next) => {
    // Handlers read an absent body as an empty object, as they did under NestJS.
    if (req.body === undefined) req.body = {};
    edgeTrust(req);
    next();
  });
  const secure = config().COOKIE_SECURE;
  // The studio and runtime reach the API through same-origin proxies; no CORS is enabled.
  app.use((_req, res, next) => {
    for (const [k, v] of securityHeaders(secure)) res.setHeader(k, v);
    next();
  });

  // Security review S4: in production the counters are shared by every API process (database store).
  const throttleStoreImpl = throttleStore() === 'database' ? new DbThrottlerStorage(get(PrismaService)) : new MemoryThrottleStore();
  const kit = createRouteKit({ auth: get(AuthGuard), throttleStore: throttleStoreImpl, get });
  const router = express.Router();
  for (const mount of ROUTES) mount(router, get, kit);
  app.use(router);
  app.use((req, res) => {
    res.status(404).json({ message: `Cannot ${req.method} ${req.path}`, error: 'Not Found', statusCode: 404 });
  });
  app.use(errorHandler);

  let server: Server | undefined;
  let started = false;
  let stopped = false;
  const services = () => PROVIDERS.map(([token]) => get(token) as Hooks);

  const api: ApiApp = {
    express: app,
    get,
    async init() {
      if (started) return api;
      started = true;
      container.all();
      for (const s of services()) await s.onModuleInit?.();
      for (const s of services()) await s.onApplicationBootstrap?.();
      return api;
    },
    async close() {
      if (stopped) return;
      stopped = true;
      if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
      if (started) for (const s of services().reverse()) await s.onModuleDestroy?.();
    },
    getHttpServer() {
      server ??= createServer(app);
      return server;
    },
    async listen(port) {
      await api.init();
      const s = api.getHttpServer();
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.listen(port, () => resolve());
      });
      return s;
    },
  };
  return api;
}

/** Stops cleanly on SIGTERM / SIGINT (ECS sends SIGTERM before it stops a task). */
export function closeOnSignals(app: { close(): Promise<void> }, logger: Logger) {
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`${signal} received, shutting down`);
      app.close().then(
        () => process.exit(0),
        (e: unknown) => {
          logger.error(`Shutdown failed: ${(e as Error).message}`);
          process.exit(1);
        },
      );
    });
  }
}
