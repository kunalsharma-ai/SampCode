# 0041: Plain Express replaces NestJS in the API

Status: Accepted (2026-11-09). Amends ADR 0001 (the modules stay, NestJS goes).

## Context

The owner asked for Express and MongoDB in the API. The API already ran NestJS on top of Express, and the
owner chose to remove NestJS altogether, so the code that answers requests is plain Express that anyone who
knows Express can read, without decorators, modules or dependency injection by reflection.

What NestJS did for us, and had to be kept with the same behaviour (the 348 API tests and 30 end-to-end tests
did not change, apart from how they start the app):

- Routing from `@Controller` / `@Get` / `@Post` decorators, with `@Param`, `@Body`, `@Query`, `@Headers`, `@Ip`,
  `@Res`, file uploads (`FileInterceptor`) and `@HttpCode` / `@Header`.
- A global sign-in and role guard (`@Public()`, `@Roles(...)`), the SCIM token guard and SCIM error format.
- Rate limits (`@nestjs/throttler`) with per-route limits and the shared database store (security review S4).
- `HttpException` and its subclasses, and their JSON bodies, which the studio, the apps and API clients read.
- Building every service once with its dependencies, and the start and stop hooks (connect, load settings,
  start and stop the workers).

## Decision

1. **Routes are plain functions.** Each controller is a plain class; its file ends with a
   `xxxControllerRoutes(router, controller, kit)` function that registers its routes, e.g.
   `r.get('/api/surveys/:id', ...kit.route({ controller: 'SurveysController', handler: 'detail', method: 'get' }, (req) => c.detail(req.user as AuthUser, req.params.id)))`.
   `kit.route` (src/http/routes.ts) returns the middleware chain: rate limit, sign-in and role check (unless
   `public`), extra guards, file upload, then the handler. The handler's return value is the answer (JSON,
   text or empty, status 201 for POST and 200 otherwise unless `status` or the handler's own `res.status()`
   says else); `raw` handlers write the response themselves.
2. **One composition root** (src/container.ts) lists every service and controller and what it is built from.
   Services are built once, on first use. Abstract classes stay the tokens for swappable parts (`FileStore`,
   `AiProvider`, `SecretBox`, `RedirectService`), and tests replace one with
   `createApp({ overrides: [[AiProvider, fake]] })`. Start hooks (`onModuleInit`, then `onApplicationBootstrap`)
   run in the order of `PROVIDERS`, stop hooks (`onModuleDestroy`) in the reverse order.
3. **src/http/app.ts builds the Express app**: cookies, the JSON parser (which keeps raw bytes for the Stripe
   and SampAudience webhooks), form bodies, edge trust, security headers, the routes, a JSON 404, and one error
   middleware that answers `HttpException` with its body, body-parser errors with 400/413, and anything else
   with `500 { statusCode: 500, message: 'Internal server error' }` (logged). main.ts listens; worker.ts only
   runs the start hooks; both stop cleanly on SIGTERM.
4. **Small replacements for the Nest packages**, in src/http: `errors.ts` (same class names and bodies),
   `logger.ts`, `jwt.ts` (jsonwebtoken, same HS256 tokens), `throttle.ts` (same limits, headers and 429 body).
5. The module folders stay as they are (ADR 0001): each module still owns its controllers and services and
   can be split out later.

## Consequences

- No decorators or `reflect-metadata`; the API compiles with plain `tsc` and tests run without SWC.
- Adding an endpoint is one line in the controller's route function; adding a service is one line in
  src/container.ts. A missing service fails at start with "X is not registered in src/container.ts".
- Type-only imports are enforced in the API like everywhere else (no runtime class metadata is needed).
- Behaviour visible to clients is unchanged: same paths, status codes, error bodies, headers and rate limits.
  A request with malformed JSON is answered with a JSON 400 body.
