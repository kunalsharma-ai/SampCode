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
| 5   | In the CRM, **Settings → Integrations**: paste every API key (Claude, then IPinfo, Deepgram, Twilio, SendGrid, Stripe, S3, SampAudience)          | The provider accounts                    | [below](#integrations-are-set-up-in-the-crm)                                     |
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
# Fill in the two MongoDB passwords (openssl rand -hex 24 each), the three domains and ACME_EMAIL
# before the first start. Nothing else: no API key and no secret goes in this file (ADR 0043).
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

The first start builds the images (about ten minutes), creates the MongoDB user and replica set,
creates the collections and indexes (the `migrate` service), and Caddy fetches the HTTPS certificates
once DNS points at the server. Then open `https://<STUDIO_DOMAIN>`.

On that first start SampCode also makes the secrets it needs for itself, so nobody has to generate
them: the `app-key` service writes a random master key (`SECRETS_KEY`) into its own Docker volume, and
the API makes `JWT_SECRET` (sign-in sessions) and `SIGNING_KEYS_SECRET` (test links, hashes, SSO state)
and keeps them in MongoDB, encrypted with that master key.

**Keep a copy of the master key now**, in a password manager or wherever the backups go. It is not in
the database backups (on purpose: a stolen backup alone cannot open the saved API keys), and without
it a restored backup cannot open them either:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api cat /run/sampcode-key/secrets_key
```

To restore on a new server, put the saved key in place before the API starts for the first time:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --entrypoint sh app-key \
  -c 'printf %s "<saved key>" > /key/secrets_key; chmod 400 /key/secrets_key; chown 1000:1000 /key/secrets_key'
```

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
  [database.md](database.md). Uploaded files are in the `files` Docker volume (or in S3 when the S3
  integration is on); back that volume up too. Keep the master key with the copies (see above).
- **What is open to the internet:** only Caddy (80 and 443). MongoDB needs a password and is reachable
  only inside the compose network. Keep SSH to key sign-in, and turn on the host firewall
  (`ufw allow 22,80,443/tcp`). Docker publishes only Caddy's ports.

## Integrations are set up in the CRM

Every API key is entered from inside SampCode and stored in the database, never in `.env.production`
or another server file (ADR 0043). The server does not read any API key from its environment; old
variables such as `ANTHROPIC_API_KEY` are ignored, and the API log lists any that are still set. An
administrator of the organization that runs the installation (the first organization created; hand
it over with `node apps/api/dist/cli/set-operator.js <member email>`) opens **Settings →
Integrations**, pastes the key, presses **Test connection**, ticks **Turn on** and saves. The change
reaches every server and the background worker within 15 seconds, with no restart or redeploy.

| Integration  | What it needs                                                                    | Where to get it                                                       |
| ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Claude       | API key; model optional (defaults to `claude-opus-5-5`), per-task models, prices | console.anthropic.com → API keys                                      |
| IPinfo       | Access token on a plan with privacy detection                                    | ipinfo.io → Token                                                     |
| Deepgram     | API key and model (e.g. `nova-3`)                                                | console.deepgram.com → API keys                                       |
| Twilio       | Account SID, auth token, a caller ID (phone dialer) and/or an SMS sender         | console.twilio.com → Account info, Phone numbers                      |
| SendGrid     | API key with Mail Send, a verified sender address (invitations, password resets) | app.sendgrid.com → Settings → API Keys, Sender Authentication         |
| Stripe       | Secret key, webhook signing secret, plan prices (`{"team":"price_..."}`)         | dashboard.stripe.com → Developers; add the webhook URL the page shows |
| Amazon S3    | Bucket, region and access keys (only when files go to S3 instead of the server)  | The S3 console                                                        |
| SampAudience | Address, client secret and outcome secret                                        | The SampAudience team                                                 |
| CDN          | Only with a CDN in front: the shared secret it sends as `X-Zapx-Edge`            | Your own random value (`openssl rand -hex 32`)                        |

The super admin console (Super admin → Integrations) shows the same integrations for the whole
installation. For scripted installs, `node apps/api/dist/cli/set-integration.js <key> -` saves one
from a JSON object on standard input, checked and encrypted exactly as the page does.

How it is kept safe:

- Keys are encrypted (AES-256-GCM) with `SECRETS_KEY` before they reach the database, and the page
  never shows them again, only their last four characters.
- Only administrators of the operator organization can open the page, only when signed in (not with
  an API key). Customer organizations never see it.
- Every save, test and reset is in the audit log (Settings → Audit log), saying which fields changed
  but never their values.
- The test calls go only to each provider's fixed address, so the page cannot be used to reach other
  servers (SampAudience's address is itself a setting only these administrators can change).
- **Forget saved settings** deletes what was saved for one integration and turns it off.

Set up per organization (each customer connects its own, on the main Settings page): single sign-on
(OIDC and SAML), SCIM, webhooks, API keys and AI limits. PROJEXA and other sample vendors are set up
per project under Vendors.

## Troubleshooting survey links and AI

- **Survey links do not open (`ERR_SSL_UNRECOGNIZED_NAME_ALERT` or a certificate error).** The
  respondent domain is not served by Caddy. Set `RUNTIME_DOMAIN` (for example
  `survey-zapx.sampledge.com`) in `.env.production`, point that name's DNS A record at the server,
  and restart the stack with `docker compose -f docker-compose.prod.yml up -d`. Caddy then fetches
  its certificate. The survey's Distribute tab and the panel shown after publishing run the same
  check (`GET /api/health/survey-links`) and say what is wrong.
- **AI assistant says it is not set up.** The Claude key is missing or turned off. A super admin
  opens **Super admin → Integrations → Claude (Anthropic)**, pastes the API key, presses **Test
  connection**, ticks **Turn on** and saves. The model can stay empty.

## What still needs a developer

Only what SampCode needs before it can read its database is in `.env.production`: the database users
and passwords, and the web addresses. None of it is an API key. It is set once when the server is set
up (steps 1 to 3) and rarely again:

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
  raise it to 2 in `docker-compose.prod.yml`, set `GEO_COUNTRY_HEADER` (for example `cf-ipcountry`), and
  enter the CDN's shared secret in Settings → Integrations → CDN.
- **Where work runs:** `JOB_WORKER`, `CALLBACK_WORKER` and the worker service; size limits and
  retention (`UPLOAD_MAX_MB`, `CAPTURE_RETENTION_DAYS` and similar).
- **Sign-up:** `ALLOW_SIGNUP` and `DEFAULT_PLAN`.
- **Residency:** `DATA_REGION` (the region this deployment declares for data residency).
- **Secrets SampCode makes itself:** the master key (`app-key` volume; keep a copy, see above),
  `JWT_SECRET` and `SIGNING_KEYS_SECRET` (in the database). An environment variable of the same name
  still wins, for a server that already had them.

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
