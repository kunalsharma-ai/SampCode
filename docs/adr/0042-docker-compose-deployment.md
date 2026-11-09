# 0042: Production runs on Docker Compose; Terraform and AWS are removed

Status: Accepted (2026-11-09). Supersedes ADR 0005 (AWS ECS/Fargate) and the AWS parts of ADRs 0019 and
0020 (Terraform, CloudFront, WAF, autoscaling, AWS Backup), and the MongoDB Atlas setup added in #58.

## Context

The owner deploys SampCode with Docker Compose and does not want Terraform. The repository had a full AWS
stack in `infra/terraform` (ECS, a load balancer, CloudFront, WAF, MongoDB Atlas over PrivateLink, AWS Backup)
and a release script for it, none of which had been applied to a real account. The same Docker images already
ran the whole product locally under `docker-compose.yml`, which uses example secrets and opens every port, so
it is not safe to deploy as it is.

## Decision

- **`docker-compose.prod.yml`** is the production deployment: one Linux server, the images from the
  `Dockerfile`, built on the server. Services: `mongo` (one-member replica set `rs0` with a key file and
  passwords), `migrate` (collections and indexes, before the API starts), `api`, `worker`, `studio`,
  `runtime`, `capi`, `caddy` and `backup`.
- **Caddy** is the only service published on the host (80 and 443). It gets and renews Let's Encrypt
  certificates for the three domains (`STUDIO_DOMAIN`, `RUNTIME_DOMAIN`, `CAPI_DOMAIN`) and sends every
  `/api/` request straight to the API, so the API always has one proxy in front (`TRUST_PROXY_HOPS=1`). The
  respondent and interviewer apps keep their 1 MB request limit on `/api/`.
- **MongoDB** has a root user (people, the replica set) and an app user with `readWrite` on `zapx` only
  (`infra/mongo/create-app-user.sh`), which the API, worker, migrate job and backups use. Both are created
  on the first start; MongoDB is reachable only inside the compose network. The `GLIBC_TUNABLES` workaround
  for Linux 6.19+ kernels (#62) is kept.
- **Settings** live in `.env.production` (from `.env.production.example`). The compose file refuses to start
  without the domains, the three secrets and the MongoDB passwords, and fixes the settings production needs
  (`NODE_ENV`, `COOKIE_SECURE`, the public URLs, `TRUST_PROXY_HOPS`). Integrations stay in the CRM
  (ADR 0035).
- **Backups**: the `backup` service writes a `mongodump` archive every 24 hours and keeps 14 on the server;
  copying them off the server is the operator's job (docs/operations/database.md).
- **CI**: the `deploy-smoke` workflow boots this file on every change to it (and on `main`), with Caddy's
  local certificates for `*.localhost`, checks the three apps over HTTPS, checks that MongoDB is not
  published, and takes and restores a backup. `scripts/check.sh` validates the file with
  `docker compose config` where Docker is installed.
- **Removed**: `infra/terraform`, `infra/scripts/deploy-aws.sh`, and the Terraform step of `scripts/check.sh`.
  S3 file storage (`FILE_STORE=s3`), `DB_SCHEME=mongodb+srv` and the edge settings stay as options; nothing
  in the application depended on AWS.

## Consequences

- One server is one failure domain: no autoscaling and no second zone. A day's work can be lost between
  backups unless `BACKUP_INTERVAL_HOURS` is lowered. Growing past one server means a managed or multi-member
  MongoDB and more API containers behind Caddy; the images already allow both.
- There is no WAF. The API's own rate limits remain, and a CDN with a WAF (for example Cloudflare) can be put
  in front later; then `TRUST_PROXY_HOPS` becomes 2 and `GEO_COUNTRY_HEADER` and `EDGE_SHARED_SECRET` can be set.
- Operating the server (updates, firewall, SSH, disk) and the off-server backup copies are the owner's.
