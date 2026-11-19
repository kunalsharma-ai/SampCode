# 0043: Every API key is stored in the database; only database settings stay in the environment

Status: Accepted (2026-11-16). Completes ADR 0035 (integrations in the CRM) by removing its
environment fallback, and changes how ADR 0042's `.env.production` is filled in.

## Context

The owner wants anyone to be able to install SampCode without editing configuration files: "all API
keys must be accepted or stored in our database, not with ENV or any configuration", and "keep
database keys in .env only, rest in database". ADR 0035 had put six providers (Claude, IPinfo, Deepgram,
Twilio, Stripe, S3) in Settings → Integrations, but each field still fell back to an environment
variable, and several keys had no CRM field at all: SendGrid (`EMAIL_PROVIDER`, `SENDGRID_API_KEY`,
`EMAIL_FROM`), the Twilio SMS sender (`SMS_PROVIDER`, `SMS_FROM`), SampAudience (`SAMPLEON_URL`,
`SAMPLEON_CLIENT_SECRET`, `SAMPLEON_OUTCOME_SECRET`) and the CDN shared secret (`EDGE_SHARED_SECRET`).
`.env.production` also asked for three random secrets (`JWT_SECRET`, `SECRETS_KEY`,
`SIGNING_KEYS_SECRET`).

## Decision

- **API keys come only from the database.** The integration registry
  (`apps/api/src/platform/integrations.ts`) has no environment fallback: an integration is on only when
  it is switched on in the CRM and its required fields are filled in. Fields may have a default
  (Twilio's callback address, SendGrid's sender name, the Stripe fallback plan, the SampAudience
  client ID). The retired variables are removed from `config.ts`; `RETIRED_ENV` lists them and the API
  and worker log a warning naming any that are still set, so nobody wonders why a key is not used.
- **New integrations:** `sendgrid` (API key, from address, from name), `sampleon` (SampAudience
  address, client ID, client secret, outcome secret; **Test connection** sends one signed GET that
  cannot create anything) and `cdn` (shared secret, viewer address header). Twilio gains an **SMS
  sender**; its caller ID becomes optional, and Twilio needs at least one of the two. The phone dialer
  is on with a caller ID, SMS with a sender.
- **Secrets SampCode makes for itself.** `JWT_SECRET` and `SIGNING_KEYS_SECRET` are made on the first
  start by whichever process starts first (`loadInstallationSecrets()` in `main.ts` and `worker.ts`),
  sealed with `SECRETS_KEY` and stored in the `InstallationSecret` collection; every later start and
  every other process reads the same values. An environment variable of the same name still wins, so a
  server that already had them keeps its sessions and test links, and a rotation is still possible.
- **The master key is not in the database it protects.** `SECRETS_KEY` comes from the environment or
  from the file named by `SECRETS_KEY_FILE`. `docker-compose.prod.yml` has an `app-key` service that
  writes a random key into its own `appkey` volume on the first start (like the MongoDB key file), mounted
  read-only into the API and worker. A database backup alone therefore cannot open the saved keys; the
  go-live guide tells the operator to keep a copy of the master key and how to put it back.
- **`.env.production` holds only the database users and passwords, the domains and the ACME email**
  (plus optional run settings such as `LOG_LEVEL`). None of it is an API key.
- **Test-only addresses stay in the environment** (`*_API_BASE`, `S3_ENDPOINT`): they point the code at
  local stand-ins and are not keys.
- **Scripted installs:** `node apps/api/dist/cli/set-integration.js <key> -` saves an integration from
  JSON on standard input, checked and sealed exactly as the CRM does. The e2e run uses it
  (`e2e/global-setup.ts`).

## Consequences

- A new installation is connected entirely from the browser after `docker compose up`; the only values
  a person types into a file are the two MongoDB passwords and the domains.
- An existing server that set keys in the environment must enter them in Settings → Integrations once
  (the start-up warning lists which). No production server ran with environment keys when this changed.
- Losing the master key now means losing every saved API key and the generated secrets (as losing
  `SECRETS_KEY` already did for the stored partner and SSO secrets). The API refuses to start with a
  different key rather than silently making new secrets.
- Tests save integrations into the database (`apps/api/test/support/integrations.ts`) instead of
  setting environment variables, and remove them afterwards because the test files share one database.
