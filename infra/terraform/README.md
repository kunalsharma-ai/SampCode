# SampCode on AWS (Terraform)

One stack per environment (staging, production) in one AWS account and region, with its database in
MongoDB Atlas (ADR 0040). Status: plan tests against mocked AWS, Atlas and random providers
(`tests/plan.tftest.hcl`, run by `pnpm check` when Terraform is installed). **It has not been applied
to an AWS account or Atlas organization yet.** Apply it to staging first and expect to adjust details there.

## What it creates

```
             respondents / interviewers                     research teams
                        │                                         │
        take.… / field.…│ (CloudFront + ACM us-east-1)    zapx.…  │
                        ▼                                         ▼
     ┌──────────── CloudFront ────────────┐               ┌──── ALB (443, ACM) ────┐
     │ static runtime and CAPI app (S3)   │  /api/* with  │ /api/* → API           │
     │ /api/*  ──────────────────────────────X-Zapx-Edge─▶│ the rest → studio      │
     └────────────────────────────────────┘               └──────────┬─────────────┘
                                                                     │ private subnets
                       ┌──────────────┬───────────────┬──────────────┴──┐
                       │ API (Fargate)│ worker        │ studio          │
                       └──────┬───────┴──────┬────────┴─────────────────┘
                              │              │
        PrivateLink endpoint │              │
      MongoDB Atlas replica set (3)  S3 files bucket (SSE-KMS)
```

| Part             | Resources                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Network          | VPC over 2 zones, public and private subnets, NAT (one shared, or one per zone), S3 gateway endpoint                                                                                       |
| Compute          | ECS cluster; services `api` (2), `worker` (1), `studio` (2); task `migrate`; ECR repos `api`, `studio`                                                                                     |
| Database         | MongoDB Atlas project and dedicated cluster (3-member replica set, `db_instance_size`, MongoDB 8.0), PrivateLink only, TLS 1.2+, termination protection, app user in `zapx-<env>/database` |
| Files            | Private bucket, SSE-KMS, versioning (old versions expire after 30 days), TLS-only policy                                                                                                   |
| Static apps      | Two private buckets behind CloudFront with origin access control and an SPA rewrite function                                                                                               |
| Edge             | ALB with HTTP→HTTPS, TLS 1.3 policy; CloudFront with security headers, `/api/*` uncached to the ALB                                                                                        |
| Secrets and keys | One KMS key (rotation on) for data, logs, secrets and images; Secrets Manager secret `zapx-<env>/app`                                                                                      |
| Protection       | AWS WAF on CloudFront and the ALB: AWS common, known-bad-inputs and IP-reputation rules, a per-address rate limit, logs of blocked and counted requests (sessions and secrets redacted)    |
| Scaling          | API (2–6 tasks) and studio (2–4) scale on CPU; the worker stays at 1                                                                                                                       |
| Backups          | Atlas daily snapshots (14 days) and point-in-time restore (7 days); AWS Backup vault (KMS) with a daily plan for the files bucket, kept 35 days                                            |
| Observability    | CloudWatch log groups (30 days, encrypted), Container Insights, alarms (API 5xx, unhealthy tasks) to an SNS topic; Atlas alerts (CPU, disk) by email to `alarm_email`                      |

## Before the first apply

1. **Certificates (ACM):** one in your region for `studio_domain` and `api_origin_domain`, one in
   `us-east-1` for `runtime_domain` and `capi_domain`. Validate them with DNS.
2. **State backend:** an S3 bucket for Terraform state. Create `backend.hcl` (git-ignored):
   `bucket = "..."`, `key = "zapx/staging.tfstate"`, `region = "eu-west-1"`, `use_lockfile = true`.
   The state contains `edge_shared_secret`; restrict who can read the bucket.
3. **Variables:** copy `example.tfvars` to `staging.tfvars` (git-ignored) and fill it in. Pass the
   edge secret on the command line or as `TF_VAR_edge_shared_secret` (`openssl rand -hex 32`).
   The state also holds the generated Atlas user password.
4. **MongoDB Atlas:** an Atlas organization (paid tier, billed by MongoDB or through AWS Marketplace).
   Put its id in `atlas_org_id`, create an organization API key with the _Organization Project Creator_
   role, and export it before `terraform apply`:
   `export MONGODB_ATLAS_PUBLIC_KEY=... MONGODB_ATLAS_PRIVATE_KEY=...`. Terraform creates the project,
   cluster, PrivateLink endpoint, backup schedule, app user and alerts. The first apply takes 10–20 minutes
   (the cluster); if the private connection string is still empty at the end, run `terraform apply` again.

```bash
cd infra/terraform
terraform init -backend-config=backend.hcl
terraform apply -var-file=staging.tfvars
```

5. **App secret:** put the secret values in Secrets Manager (Terraform never holds them):

```bash
aws secretsmanager put-secret-value --secret-id "$(terraform output -raw app_secret_arn)" --secret-string '{
  "JWT_SECRET": "<openssl rand -hex 32>",
  "SECRETS_KEY": "<openssl rand -base64 32>",
  "SIGNING_KEYS_SECRET": "<openssl rand -hex 32>",
  "EDGE_SHARED_SECRET": "<the same value as edge_shared_secret>",
  "ANTHROPIC_API_KEY": "",
  "STRIPE_SECRET_KEY": "",
  "STRIPE_WEBHOOK_SECRET": "",
  "IPINFO_TOKEN": "",
  "DEEPGRAM_API_KEY": "",
  "TWILIO_AUTH_TOKEN": "",
  "SENDGRID_API_KEY": ""
}'
```

The provider keys (Claude, Stripe, IPinfo, Deepgram, Twilio) are not needed here: an administrator
enters them in the CRM under **Settings → Integrations** after the first sign-in, where they are
encrypted with `SECRETS_KEY`. To keep one in Secrets Manager instead, add its name (e.g.
`ANTHROPIC_API_KEY`) to `app_secret_keys` and to this JSON; a value saved in the CRM wins over it.

Keep `SECRETS_KEY` safe: it decrypts stored vendor secrets, SSO client secrets, phone numbers and
the integration keys saved in the CRM. Changing it means entering those keys again.
Every key named in `app_secret_keys` must exist in the JSON (empty is fine), or the tasks fail
to start.

5. **DNS:** point `studio_domain` and `api_origin_domain` at `load_balancer_dns`, and
   `runtime_domain` / `capi_domain` at the `cloudfront_domains` outputs.

## Releasing

```bash
ENVIRONMENT=staging infra/scripts/deploy-aws.sh
```

builds and pushes the images tagged with the git commit, runs the migration task with the new image
and stops if it fails, rolls out the services (ECS rolls back by itself if the new tasks fail their
health checks), then publishes the runtime and CAPI app to S3 and refreshes CloudFront.

## Settings worth knowing

- Non-secret SampCode settings go in `app_environment` (see `.env.example`), e.g. `DEFAULT_PLAN`.
  Provider settings (`AI_MODEL`, `BILLING`, `STRIPE_PRICES` and the rest) are easier to set in the
  CRM under Settings → Integrations. The stack already sets the addresses, the
  database parts, `FILE_STORE=s3`, the CloudFront headers and production flags.
- Sign-up is off (`ALLOW_SIGNUP=false`); create the first organization with a temporary
  `ALLOW_SIGNUP = "true"` in `app_environment`, then remove it.
- `nat_gateway_per_az = true` survives a zone outage for outbound calls at the cost of a second NAT.
- `db_multi_az = false` is fine for staging.
- **WAF** starts with `waf_mode = "count"`: the managed rules only log. Read the logs
  (`aws-waf-logs-zapx-<env>-edge` in us-east-1, `-alb` in the region) over a week of fieldwork, add
  any rule that hits real traffic to `waf_count_only_rules`, then set `waf_mode = "block"`. The rate
  limit (`waf_rate_limit`, per address per 5 minutes) blocks in both modes; raise it for interview
  centres that share one address. `waf_mode = "off"` removes WAF (about USD 15 a month plus requests).
- **Autoscaling** owns the API and studio task counts after the first apply: Terraform no longer
  resets them. Raise `api_max_count` before a big fieldwork launch.
- **Reaching the database:** the cluster is only reachable through PrivateLink. Set `ecs_exec_enabled = true`,
  apply, and run `aws ecs execute-command --cluster <cluster> --task <task> --container api --interactive --command sh`
  (Session Manager plugin needed; every session is in CloudTrail). Turn it off again afterwards. Atlas'
  Data Explorer works too, for people with Atlas access.
- **Restores:** database: restore an Atlas snapshot or a point in time into a **new** cluster (Atlas UI or
  API), never over the live one, then point a scratch stack at it. Files: restore a recovery point from the
  AWS Backup vault into a new bucket. Do one restore test before go-live.

## Costs (rough, eu-west-1, before traffic)

NAT gateway(s), the ALB, WAF, PrivateLink, five small Fargate tasks and the Atlas cluster are the fixed
costs. Atlas M20 is roughly USD 150–200 a month (M10 about USD 60 for staging; check Atlas pricing for your
region); with AWS that is roughly USD 300–450 a month for production and about half for staging.
CloudFront, S3, logs and Atlas backup storage grow with use.

## Not included yet

Cross-region copies of backups, a bot-control or CAPTCHA layer (paid WAF rule groups), and Valkey or SQS
(not needed at the current volume, ADR 0005). Go-live order: [docs/operations/go-live.md](../../docs/operations/go-live.md).
