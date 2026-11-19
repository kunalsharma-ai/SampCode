# Configuration and environment variables

Every setting SampCode reads, where it is read, whether you must set it, and a placeholder value. No real
secret appears here; replace every `<…>` placeholder with your own value.

## Where settings come from

| Program              | Reads settings from                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API and worker       | process environment, validated once by the Zod schema in `apps/api/src/config.ts` (`config()`). Locally the root `.env` is loaded by `dotenv` in `apps/api/package.json` scripts, or by `set -a; . ./.env; set +a` before `node apps/api/dist/main.js` |
| Database tools       | `packages/db/package.json` scripts load `../../.env` (`DATABASE_URL`)                                                                                                                                                                                  |
| Studio               | `ZAPX_API_URL` at **build time** for the `/api` rewrite (`apps/studio/next.config.mjs`)                                                                                                                                                                |
| Runtime and CAPI app | `ZAPX_API_URL` for the Vite dev/preview proxy only (`vite.config.ts`); nginx config in production                                                                                                                                                      |
| Docker compose       | the `x-api-env` block in `docker-compose.yml` (with `${VAR:-default}` fallbacks from your shell)                                                                                                                                                       |
| Production (compose) | `.env.production` (from `.env.production.example`): `--env-file` fills in `docker-compose.prod.yml`, and the API and worker read the whole file; the file's `x-api-env` block fixes `NODE_ENV`, `COOKIE_SECURE`, the URLs and `TRUST_PROXY_HOPS`       |

If a value is invalid the API refuses to start with `Invalid configuration: NAME: message; …`.
Start from `.env.example` (`cp .env.example .env`).

## API keys are set in the CRM, never in the environment _(ADR 0043)_

Every third-party API key is entered in the studio under **Settings → Integrations**
(`/settings/integrations`) by an administrator of the organization that runs the installation, or by
the super admin, tested and saved. It is stored in the `PlatformIntegration` collection, secrets sealed
with `SECRETS_KEY` ([ADR 0035](../adr/0035-integrations-in-the-crm.md),
[ADR 0043](../adr/0043-api-keys-in-the-database.md)). The server reads no API key from its environment:
the variables that used to hold them (listed in `RETIRED_ENV`, `apps/api/src/platform/installation-secrets.ts`)
are ignored, and the API logs a warning naming any that are still set.

| Integration (key)         | Fields                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Claude AI (`anthropic`)   | API key, default model, models per task (architect, translate, insights), price table                                          |
| IPinfo (`ipinfo`)         | access token                                                                                                                   |
| Deepgram (`deepgram`)     | API key, model                                                                                                                 |
| Twilio (`twilio`)         | account SID, auth token, caller ID (phone dialer), SMS sender, callback address                                                |
| SMTP email (`smtp`)       | server (default `smtppro.zoho.in`), port (465/587), encryption (ssl/starttls), sender, password, from name; wins over SendGrid |
| SendGrid (`sendgrid`)     | API key, from address, from name                                                                                               |
| Stripe (`stripe`)         | secret key, webhook signing secret, plan prices, API version, plan after a subscription ends                                   |
| Amazon S3 (`s3`)          | bucket, region, folder, KMS key, access key ID and secret (outside AWS)                                                        |
| SampAudience (`sampleon`) | address, client ID, client secret, outcome secret                                                                              |
| CDN (`cdn`)               | shared secret sent as `X-Zapx-Edge`, viewer address header                                                                     |

Rules: an integration is on only when it is switched on in the CRM and its required fields are filled
in. A field left empty uses its default where it has one (for example the Twilio callback address),
otherwise it is empty. **Forget saved settings** (`DELETE`) removes the saved row and turns it off.
Each API and worker process re-reads the saved values every `INTEGRATIONS_REFRESH_MS` (default 15 000
ms). The field list comes from `INTEGRATIONS` in `apps/api/src/platform/integrations.ts`. For scripts,
`node apps/api/dist/cli/set-integration.js <key> -` saves one from JSON on standard input.

## Secrets SampCode makes for itself _(ADR 0043)_

| Secret                             | Where it lives                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- | ------------------------ |
| `SECRETS_KEY` / `SECRETS_KEY_FILE` | master key: seals every secret in the database (API keys, vendor and SSO secrets, webhook secrets, phone numbers, the two below) | yes (Compose makes it), 32+ chars                               | falls back to `JWT_SECRET` in development | `<openssl rand -hex 32>` |
| `JWT_SECRET`                       | signs sessions                                                                                                                   | no: made on the first start and kept in the database (ADR 0043) | —                                         | only to override         |
| `SIGNING_KEYS_SECRET`              | derives the keys for test links, network/device hashes and SSO state (S5)                                                        | no: made on the first start and kept in the database (ADR 0043) | —                                         | only to override         |

`loadInstallationSecrets()` runs in `main.ts` and `worker.ts` before the configuration is read. Keep a
copy of `SECRETS_KEY`: without it the saved API keys and these secrets cannot be opened.

## Production safety checks

With `NODE_ENV=production` the API also refuses to start when (`config.ts`, `superRefine`):
`COOKIE_SECURE` is not `true`; `JWT_SECRET` contains an example value (`dev-only-secret`,
`change-me`, `changeme`, `test-secret`); `SECRETS_KEY` is missing, equals `JWT_SECRET` or is an
example; `CALLBACK_ALLOW_PRIVATE_HOSTS=true`; or `SSO_ALLOW_INSECURE_ISSUER=true`.

## API and worker variables (`apps/api/src/config.ts`)

"Required" means the API will not start without it. Defaults are the code's defaults.

### Core

| Variable                                                                                                                                                  | Purpose                                                                                                                                  | Required                                                        | Default                                   | Example placeholder                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                                            | MongoDB connection for Prisma (a replica set; transactions need one). Add `&maxPoolSize=10`                                              | yes (or the `DB_*` parts below)                                 | —                                         | `mongodb://${DB_USER}:${DB_PASSWORD}@<host>:27017/zapx?replicaSet=rs0` |
| `DB_HOST`, `DB_SCHEME`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_TLS`, `DB_SSLMODE`, `DB_REPLICA_SET`, `DB_AUTH_SOURCE`, `DB_CONNECTION_LIMIT` | build `DATABASE_URL` when it is unset (`apps/api/src/database-url.ts`; on AWS Terraform sets `DB_SCHEME=mongodb+srv` and the Atlas host) | only without `DATABASE_URL`                                     | port 27017, name `zapx`                   | `DB_HOST=<cluster-endpoint>`                                           |
| `LOG_LEVEL`                                                                                                                                               | `debug` adds debug lines, `silent` turns API logging off (`apps/api/src/http/logger.ts`)                                                 | no                                                              | `log`                                     | `debug`                                                                |
| `JWT_SECRET`                                                                                                                                              | signs sessions                                                                                                                           | no: made on the first start and kept in the database (ADR 0043) | —                                         | only to override                                                       |
| `SECRETS_KEY` / `SECRETS_KEY_FILE`                                                                                                                        | master key: seals every secret in the database (API keys, vendor and SSO secrets, webhook secrets, phone numbers, the two below)         | yes (Compose makes it), 32+ chars                               | falls back to `JWT_SECRET` in development | `<openssl rand -hex 32>`                                               |
| `SIGNING_KEYS_SECRET`                                                                                                                                     | derives the keys for test links, network/device hashes and SSO state (S5)                                                                | no: made on the first start and kept in the database (ADR 0043) | —                                         | only to override                                                       |
| `THROTTLE_STORE`                                                                                                                                          | rate-limit counters: `database` (shared by all API processes) or `memory` (S4)                                                           | no                                                              | `database` in production                  | `database`                                                             |
| `NODE_ENV`                                                                                                                                                | `production` turns on the safety checks                                                                                                  | no                                                              | `development`                             | `production`                                                           |
| `API_PORT`                                                                                                                                                | HTTP port                                                                                                                                | no                                                              | `4000`                                    | `4000`                                                                 |
| `RUNTIME_BASE_URL`                                                                                                                                        | public address of the respondent runtime, used to build survey links                                                                     | no                                                              | `http://localhost:5173`                   | `https://take.<your-domain>`                                           |
| `CAPI_APP_URL`                                                                                                                                            | address of the CAPI app, shown in the studio                                                                                             | no                                                              | `http://localhost:5174`                   | `https://field.<your-domain>`                                          |
| `STUDIO_URL`                                                                                                                                              | public studio address; SSO callback is `${STUDIO_URL}/api/auth/sso/callback`                                                             | no                                                              | `http://localhost:3000`                   | `https://zapx.<your-domain>`                                           |
| `COOKIE_SECURE`                                                                                                                                           | send the session cookie only over https                                                                                                  | `true` in production                                            | `false`                                   | `true`                                                                 |
| `ALLOW_SIGNUP`                                                                                                                                            | allow self-service sign-up (creates a new organization)                                                                                  | no                                                              | off unless `true`                         | `false`                                                                |
| `DEFAULT_PLAN`                                                                                                                                            | plan for organizations created by sign-up                                                                                                | no                                                              | `enterprise`                              | `free`                                                                 |
| `INTEGRATIONS_REFRESH_MS` _(PR #38)_                                                                                                                      | how often each process re-reads Settings → Integrations (1 000–600 000 ms)                                                               | no, default `15000`                                             |
| `MOBILE_MIN_VERSION` _(PR #40)_                                                                                                                           | oldest mobile app version allowed to sign in, e.g. `1.2.0`; older apps are asked to update                                               | no, unset = any                                                 |
| `DATA_REGION` _(PR #34)_                                                                                                                                  | region this deployment declares it keeps data in; compared with each organization's region                                               | no                                                              | empty                                     | `eu`                                                                   |

### Sign-in protection and proxies

| Variable                    | Purpose                                                                                   | Default | Example                     |
| --------------------------- | ----------------------------------------------------------------------------------------- | ------- | --------------------------- |
| `LOGIN_RATE_PER_MINUTE`     | sign-in attempts per minute per address                                                   | `10`    | `10`                        |
| `SIGNUP_RATE_PER_MINUTE`    | sign-ups per minute per address                                                           | `5`     | `5`                         |
| `LOGIN_MAX_FAILURES`        | wrong passwords in a row before the account locks                                         | `10`    | `10`                        |
| `LOGIN_LOCK_MINUTES`        | lock length                                                                               | `15`    | `15`                        |
| `PASSWORD_RESET_HOURS`      | hours a password reset link works (1–168) _(PR #36)_                                      | `24`    | `24`                        |
| `SSO_ALLOW_INSECURE_ISSUER` | allow http/private identity providers (development and tests only; refused in production) | off     | `false`                     |
| `TRUST_PROXY_HOPS`          | proxies in front of the API that add `X-Forwarded-For`                                    | `1`     | `1`                         |
| `GEO_COUNTRY_HEADER`        | header with the respondent's country (fraud check)                                        | empty   | `cloudfront-viewer-country` |

### AI

| Variable                                    | Purpose                                                   | Default       | Example     |
| ------------------------------------------- | --------------------------------------------------------- | ------------- | ----------- |
| `AI_PROVIDER`                               | provider; only `anthropic` exists                         | `anthropic`   | `anthropic` |
| `AI_MAX_RETRIES`, `AI_TIMEOUT_MS`           | provider retries and timeout                              | `2`, `600000` |             |
| `AI_BREAKER_FAILURES`, `AI_BREAKER_OPEN_MS` | circuit breaker                                           | `5`, `60000`  |             |
| `AI_DEFAULT_RPM`, `AI_DEFAULT_RPD`          | per-organization rate limits when it has no own AI policy | `10`, `500`   |             |

### Interviews, uploads and quality

| Variable                                           | Purpose                                                        | Default                           |
| -------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `ABANDON_AFTER_MINUTES`                            | idle interviews become `partial` after this                    | `1440`                            |
| `UPLOAD_MAX_MB`                                    | questionnaire file upload limit                                | `15`                              |
| `MEDIA_MAX_MB`                                     | survey media upload limit (images 10, audio 25 are fixed caps) | `100`                             |
| `CAPTURE_MAX_MB`                                   | CAPI recording limit (photos fixed at 15)                      | `100`                             |
| `CAPTURE_RETENTION_DAYS`                           | delete photos/recordings after this many days (`0` = keep)     | `0`                               |
| `IPINFO_API_BASE`, `NETWORK_REPUTATION_TIMEOUT_MS` | endpoint and timeout                                           | `https://ipinfo.io`, `2000`       |
| `DEEPGRAM_API_BASE`, `TRANSCRIPTION_TIMEOUT_S`     | endpoint and timeout                                           | `https://api.deepgram.com`, `600` |

### Phone, email and SMS

| Variable                                      | Purpose                                                                        | Default                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `TWILIO_API_BASE`, `TELEPHONY_RING_SECONDS`   | endpoint and ring time                                                         | `https://api.twilio.com`, `30`                 |
| `SENDGRID_API_BASE` _(PR #32)_                | endpoint and sender name                                                       | `https://api.sendgrid.com`, `SampCode surveys` |
| `SMTP_TEST_ENDPOINT` _(tests only, ADR 0044)_ | local plain-SMTP stand-in, e.g. `smtp://127.0.0.1:2525`; refused in production | not set                                        |

### Background work, files and callbacks

| Variable                                                | Purpose                                                                                   | Default             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------- |
| `JOB_WORKER`                                            | run the job loop in this process (`off` when the worker process runs)                     | `on`                |
| `JOB_POLL_MS`                                           | job loop interval                                                                         | `2000`              |
| `CALLBACK_WORKER`                                       | run callbacks/webhooks loop in this process                                               | `on`                |
| `CALLBACK_POLL_MS`, `CALLBACK_TIMEOUT_MS`               | interval and per-request timeout                                                          | `5000`, `10000`     |
| `CALLBACK_ALLOW_PRIVATE_HOSTS`                          | let callbacks/webhooks reach localhost/private networks (dev only; refused in production) | off                 |
| `FILES_DIR`                                             | local file folder (shared by API and worker)                                              | `.data/files`       |
| `S3_ENDPOINT`                                           | region, key prefix, SSE-KMS key, test endpoint                                            | `eu-west-1`, unset… |
| `EXPORT_SYNC_MAX_ROWS`                                  | larger exports must run as background jobs                                                | `10000`             |
| `EXPORT_FILE_TTL_HOURS`                                 | export files are deleted after                                                            | `72`                |
| `JOB_RETENTION_DAYS`, `WEBHOOK_DELIVERY_RETENTION_DAYS` | housekeeping retention                                                                    | `30`, `30`          |

S3 credentials are not SampCode settings: the AWS SDK uses its normal chain (the ECS task role on AWS,
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` elsewhere).

### Billing

| Variable          | Purpose                                                 | Default                                 |
| ----------------- | ------------------------------------------------------- | --------------------------------------- |
| `STRIPE_API_BASE` | API version pin, test endpoint, plan after cancellation | unset, `https://api.stripe.com`, `free` |

## Other variables

| Variable                                                                                                                                                                                                                  | Used by                                                                                                          | Purpose                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ZAPX_API_URL`                                                                                                                                                                                                            | `apps/studio/next.config.mjs`, `apps/runtime/vite.config.ts`, `apps/capi/vite.config.ts`, `Dockerfile` build arg | where the front ends proxy `/api` (default `http://localhost:4000`; `http://api:4000` in Docker)                       |
| `SEED_EMAIL`, `SEED_PASSWORD`                                                                                                                                                                                             | `packages/db/src/seed.ts`                                                                                        | seed account                                                                                                           |
| `PW_CHROMIUM_PATH`                                                                                                                                                                                                        | `e2e/playwright.config.ts`                                                                                       | use a specific Chromium                                                                                                |
| `E2E_REUSE`                                                                                                                                                                                                               | mentioned in `e2e/playwright.config.ts` comment                                                                  | **Needs Verification:** the config always uses `reuseExistingServer: true`, so this variable appears to have no effect |
| `PROJEXA_URL`, `PROJEXA_EMAIL`, `PROJEXA_PASSWORD`, `ZAPX_API_URL`, `ZAPX_RUNTIME_URL`, `ZAPX_EMAIL`, `ZAPX_PASSWORD`, `CHECK_TIMEOUT_S`                                                                                  | `scripts/projexa-check.mjs`                                                                                      | PROJEXA end-to-end check                                                                                               |
| `KEEP`                                                                                                                                                                                                                    | `infra/scripts/backup.sh`                                                                                        | number of backups kept (14)                                                                                            |
| `STUDIO_DOMAIN`, `RUNTIME_DOMAIN`, `CAPI_DOMAIN`, `ACME_EMAIL`, `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD`, `MONGO_APP_USER`, `MONGO_APP_PASSWORD`, `BACKUP_DIR`, `BACKUP_INTERVAL_HOURS`, `BACKUP_KEEP`, `TAG`, `ENV_FILE` | `docker-compose.prod.yml` (`.env.production.example`)                                                            |

## Gaps found

- `.env.example` does not list `DATA_REGION`,
  `SENDGRID_API_BASE`, `IPINFO_API_BASE`, `DEEPGRAM_API_BASE`, `TWILIO_API_BASE`,
  `TELEPHONY_RING_SECONDS`, `TRANSCRIPTION_TIMEOUT_S`, `NETWORK_REPUTATION_TIMEOUT_MS`,
  `AI_TIMEOUT_MS`, `STRIPE_API_BASE`. They all have safe defaults, so nothing breaks, but they are
  easy to miss.
- **History (the Terraform was removed with ADR 0042):** fixed in PR #36: on AWS, `app_secret_keys` (`infra/terraform/variables.tf`)
  included `TWILIO_AUTH_TOKEN` but the example secret JSON in `infra/terraform/README.md` did not,
  and `SENDGRID_API_KEY` had no secret slot. Both now match (and a test checks it). Every key in
  `app_secret_keys` must exist in the secret, empty if unused, or the tasks fail to start. With PR #38
  the list itself is unchanged (`variables.tf` still lists all nine keys), but the Terraform README
  now says provider keys can be entered in the CRM instead. **Needs Verification:** if you leave the
  provider keys out of the secret, also remove them from `app_secret_keys`, or the tasks fail to start.
- `ANTHROPIC_API_BASE` _(PR #38)_ exists only for tests (an Anthropic-compatible stand-in); leave it
  at its default.

## Super admin automation _(PR #41; [ADR 0036](../adr/0036-super-admin.md))_

| Variable                 | Default | What it does                                                                 |
| ------------------------ | ------- | ---------------------------------------------------------------------------- |
| `PLATFORM_AUTOMATION`    | `on`    | Check the super admin's automation rules in this API process                 |
| `PLATFORM_AUTOMATION_MS` | `60000` | How often (ms). Several processes are safe: each firing is claimed only once |

The first super admin is made with `node apps/api/dist/cli/set-super-admin.js <email>` (the member must
belong to the organization that runs the installation; see `set-operator.js`). Remove with `--remove`.

## Mobile app settings _(PR #40)_

The mobile app has no environment file. The member types the server address (the studio address)
on the sign-in screen. Build settings are in `apps/mobile/app.json` (name, icons, bundle id
`com.sampledge.zapx`) and `apps/mobile/eas.json` (EAS build profiles). Store accounts and signing keys
are not in the repository; see [docs/operations/mobile-release.md](../operations/mobile-release.md).
On the server, `MOBILE_MIN_VERSION` sets the oldest app version allowed.
