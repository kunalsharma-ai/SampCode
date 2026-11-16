# Going live: what needs a person with the accounts

Everything in SampCode that could be built and tested without real accounts is done and merged into
`main`: milestones 1 to 20 and PRs #27 to #64 (the design system, the blueprint phases, the handbook,
the security fixes, webcam eye tracking, integrations in the CRM, the super admin console, the mobile
app, Node 26, SampAudience, MongoDB and plain Express, ADRs 0040 and 0041). SampCode is deployed with
**Docker Compose on one Linux server** (ADR 0042): `docker-compose.prod.yml` runs MongoDB, the API, the
worker, the three apps, Caddy for HTTPS and a backup service. The steps below need a server, accounts
or decisions that only the owner has. Do them on a **staging** server first, in this order.

| #   | Step                                                                                                                                              | Needs                                    | Guide                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | A Linux server (Ubuntu 24.04 LTS, 4 vCPU, 16 GB memory, 100 GB SSD for a start) with Docker Engine and the Compose plugin; ports 22, 80, 443 open | A cloud or hosting account               | [below](#deploying-with-docker-compose)                                          |
| 2   | DNS: an A (and AAAA) record for each of the three domains (studio, survey link, interviewer app) pointing at the server                           | DNS for the domains                      | same                                                                             |
| 3   | Clone the repository on the server, write `.env.production` from `.env.production.example`, then `docker compose ... up -d --build`               | SSH to the server                        | same                                                                             |
| 4   | Create the first organization (temporary `ALLOW_SIGNUP=true`, then back to `false` and `up -d` again)                                             | —                                        | same                                                                             |
| 5   | In the CRM, **Settings → Integrations**: connect Claude, then IPinfo, Deepgram, Twilio, Stripe as needed                                          | The provider accounts                    | [below](#integrations-are-set-up-in-the-crm)                                     |
| 6   | Run `scripts/projexa-check.mjs` against the deployed PROJEXA                                                                                      | A deployed PROJEXA and its client keys   | [redirects.md](../modules/redirects.md)                                          |
| 7   | Connect your real identity provider (OpenID Connect or SAML) and, if wanted, SCIM, in Settings                                                    | IdP admin (Entra ID, Okta, Google)       | [sso-scim-plans.md](../modules/sso-scim-plans.md)                                |
| 8   | Copy the backups off the server every day (another server or a storage bucket), and do one restore test on the staging server                     | Somewhere to keep the copies             | [database.md](database.md)                                                       |
| 8b  | Only if a PostgreSQL installation already holds real data: copy it with `copy-from-postgres` during a short stop                                  | the old database URL                     | [database.md](database.md#moving-an-existing-postgresql-installation-to-mongodb) |
| 9   | Production server: repeat 1 to 5 on its own server and domains, with its own new secrets                                                          | As above                                 | same                                                                             |
| 10  | Mobile app: Expo account, Google Play Console and Apple Developer accounts, then build and submit                                                 | Store accounts, privacy and support URLs | [mobile-release.md](mobile-release.md)                                           |

## Deploying with Docker Compose

On the server, as a user in the `docker` group:

```bash
git clone https://github.com/kunalsharma-ai/Sampledge-ZAPX.git sampcode && cd sampcode
cp .env.production.example .env.production && chmod 600 .env.production
# Fill in the domains, ACME_EMAIL, the three secrets (openssl rand -hex 32 each) and the
# two MongoDB passwords (openssl rand -hex 24 each) before the first start.
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

The first start builds the images (about ten minutes), creates the MongoDB user and replica set,
creates the collections and indexes (the `migrate` service), and Caddy fetches the HTTPS certificates
once DNS points at the server. Then open `https://<STUDIO_DOMAIN>`.

- **First organization:** set `ALLOW_SIGNUP=true` in `.env.production`, run the `up -d` command again,
  sign up, then set it back to `false` and run `up -d` once more. The first organization runs the
  installation (Settings → Integrations); hand that over later with
  `docker compose -f docker-compose.prod.yml --env-file .env.production exec api node apps/api/dist/cli/set-operator.js <member email>`.
- **Updates:** `git pull`, then `TAG=$(git rev-parse --short HEAD) docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build`.
  The migrate service runs again before the new API starts. To go back, check out the previous commit
  and run the same command (keep the old images with `docker image ls sampcode-*`).
- **Logs:** `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api worker`.
  Each container keeps at most 100 MB of logs.
- **Backups:** the `backup` service writes a `mongodump` archive to `./backups` every 24 hours and
  keeps 14. That folder is on the same disk, so copy it elsewhere every day; the restore steps are in
  [database.md](database.md). Uploaded files are in the `files` Docker volume (or S3 with
  `FILE_STORE=s3`); back that volume up too.
- **What is open to the internet:** only Caddy (80 and 443). MongoDB needs a password and is reachable
  only inside the compose network. Keep SSH to key sign-in, and turn on the host firewall
  (`ufw allow 22,80,443/tcp`). Docker publishes only Caddy's ports.

## Integrations are set up in the CRM

Every third-party service and API key is connected from inside SampCode, not by editing server settings; only the database address and the server's own keys (`JWT_SECRET`, `SECRETS_KEY`, `SIGNING_KEYS_SECRET`) stay in the environment. An
administrator of the organization that runs the installation (the first organization created; hand
it over with `node apps/api/dist/cli/set-operator.js <member email>`) opens **Settings →
Integrations**, pastes the key, presses **Test connection**, ticks **Turn on** and saves. The change
reaches every server and the background worker within 15 seconds, with no restart or redeploy.

| Integration | What it needs                                                                    | Where to get it                                                       |
| ----------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Claude      | API key and model (e.g. `claude-opus-5-5`); optional per-task models and prices  | console.anthropic.com → API keys                                      |
| IPinfo      | Access token on a plan with privacy detection                                    | ipinfo.io → Token                                                     |
| Deepgram    | API key and model (e.g. `nova-3`)                                                | console.deepgram.com → API keys                                       |
| Twilio      | Account SID, auth token, a voice number; the callback address defaults to studio | console.twilio.com → Account info, Phone numbers                      |
| Stripe      | Secret key, webhook signing secret, plan prices (`{"team":"price_..."}`)         | dashboard.stripe.com → Developers; add the webhook URL the page shows |
| Amazon S3   | Bucket, region and access keys (only when files go to S3 instead of the server)  | The S3 console                                                        |
| SendGrid    | API key with Mail Send, a verified sender address and name                       | app.sendgrid.com → Settings → API keys, Sender Authentication          |
| SMS         | Under Twilio: the SMS sender (number or Messaging Service SID)                   | console.twilio.com → Phone numbers / Messaging                        |
| SampAudience | Its address, the signing secret and outcome secret SampAudience shows for client `zapx` | SampAudience console → Settings → Connected systems (events go to the address the page shows) |

How it is kept safe:

- Keys are encrypted (AES-256-GCM) with `SECRETS_KEY` before they reach the database, and the page
  never shows them again, only their last four characters.
- Only administrators of the operator organization can open the page, only when signed in (not with
  an API key). Customer organizations never see it.
- Every save, test and reset is in the audit log (Settings → Audit log), saying which fields changed
  but never their values.
- The test calls go only to each provider's fixed address, so the page cannot be used to reach other
  servers.
- Anything saved in the CRM wins over the server environment, and a field left empty falls back to
  it. **Use server settings instead** forgets what was saved. Existing environment variables keep
  working, so nothing breaks on upgrade.

Set up per organization (each customer connects its own, on the main Settings page): single sign-on
(OIDC and SAML), SCIM, webhooks, API keys and AI limits. PROJEXA and other sample vendors are set up
per project under Vendors.

## What still needs a developer

These protect or run the server itself, so they cannot be changed from a web page. They are set once
when the server is set up (steps 1 to 3), in `.env.production`, and rarely again:

- **Master keys:** `JWT_SECRET` (sign-in sessions), `SECRETS_KEY` (encrypts every key saved in
  the CRM) and `SIGNING_KEYS_SECRET` (test links, network and device hashes, SSO state; required in
  production). Changing `SECRETS_KEY` means entering the integration keys again.
- **Database:** `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` (for people and the replica set) and
  `MONGO_APP_USER` / `MONGO_APP_PASSWORD` (what the apps connect as: `readWrite` on the `zapx` database
  only). The compose file builds the connection string. Set them before the first start: MongoDB
  creates both users only on an empty volume.
- **Addresses and HTTPS:** `STUDIO_DOMAIN`, `RUNTIME_DOMAIN`, `CAPI_DOMAIN` and `ACME_EMAIL`. The
  compose file turns them into `STUDIO_URL`, `RUNTIME_BASE_URL` and `CAPI_APP_URL`, and Caddy gets the
  certificates.
- **The server:** its size, disk, firewall, SSH access and operating system updates, and where the
  backup copies go.
- **Edge and proxies:** `TRUST_PROXY_HOPS` is 1 (Caddy). If a CDN such as Cloudflare is put in front,
  raise it to 2 in `docker-compose.prod.yml` and set `GEO_COUNTRY_HEADER` (for example `cf-ipcountry`)
  and `EDGE_SHARED_SECRET`.
- **Where work runs:** `JOB_WORKER`, `CALLBACK_WORKER` and the worker service; size limits and
  retention (`UPLOAD_MAX_MB`, `CAPTURE_RETENTION_DAYS` and similar).
- **Sign-up:** `ALLOW_SIGNUP` and `DEFAULT_PLAN`.
- **Email, SMS and residency:** `EMAIL_PROVIDER` and `SENDGRID_API_KEY` (invitations, password
  resets), `SMS_PROVIDER` and `SMS_FROM` (SMS invitations; the Twilio account comes from the Twilio
  integration), and `DATA_REGION` (the region this deployment declares for data residency).

## What to watch on staging

These parts were tested only against stand-ins, so they are the most likely to need adjustment:

- **S3** (tested against a fake S3): an export download, a media upload and a CAPI photo.
- **SAML and OpenID Connect** (tested against test identity providers): one sign-in per provider,
  from a private window, with an administrator keeping a password.
- **Stripe** (tested against a fake Stripe): one Checkout in test mode, one cancellation in the
  portal, and the webhook log in the Stripe dashboard showing 200 answers.
- **The production compose file** (booted in CI by the `deploy-smoke` workflow, with Caddy's local
  certificates): the first real Let's Encrypt certificate for each domain, and the first nightly backup
  in `./backups`.
- **Express** (#60): the API answers exactly as before in all 348 API and 30 browser tests; on staging,
  watch the API log for error lines after the first day of real use.
- **No WAF in front:** the API's own rate limits (sign-in, sign-up, interviews, the vendor API) are the protection
  now. If real fieldwork brings abusive traffic, put Cloudflare (or another CDN with a WAF) in front.
- **IPinfo, Deepgram and Twilio** (each tested against a local stand-in): one interview from a VPN,
  one transcript, and one dialled call with recording to your own two phones, from a Twilio trial.
- **Test connection** on each integration was tested against stand-ins too: the first real key for
  each provider is the check that its answers are read correctly.
- **PROJEXA**: tested against PROJEXA's code run locally. Separate PROJEXA finding: a duplicate
  client code on `POST /api/v1/clients` answers 500 instead of 409.

## Product gaps that need a provider or a decision

Not built because each needs a third-party service or a product decision:

- Voice-over per language (a text-to-speech provider) and transcription of typed open answers.
- Predictive dialing, answering-machine detection and an in-browser softphone for CATI.
- Nets, banner books and PowerPoint in analysis; hierarchical Bayes estimation for MaxDiff and conjoint
  (both are built with whole-sample estimation).
- Webcam eye tracking is built as an experimental, opt-in task, but it has not been validated on real
  webcams; test it with a few real respondents before selling it (ADR 0034).
- Seat-based or usage-based billing; SAML single logout and encrypted assertions.
