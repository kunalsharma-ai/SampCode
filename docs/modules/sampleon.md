# SampAudience integration

> **Name change:** this system was called SAMPLEON and is now **SampAudience** (by Sampledge; ADR 0039). The studio uses the new name and logo (`apps/studio/public/brand/sampaudience/`); the vendor code `SAMPLEON` (`vid=SAMPLEON`), the `SAMPLEON` integration value, API paths and `SAMPLEON_*` env vars are unchanged. Migration `20261122000000_sampaudience_vendor_name` renames the display name of existing integration vendors.

SampAudience is the Sampledge audience, invitation and routing engine (repository
`kunalsharma-ai/Sampleon`, design in its `docs/ECOSYSTEM_ARCHITECTURE.md`). In the ecosystem:

- **SampCode** programs, hosts and runs the survey, records the outcome and confirms it.
- **SampAudience** decides who is invited and when, counts quotas, and routes a respondent onward.
- **SUPPLY360** owns the respondents; **PROJEXA** owns projects when there is one.

SampCode keeps no respondent list, no invitation engine and no second quota service for SampAudience
traffic. It keeps one `SampleonAudienceRequest` row per request so the studio can show progress.

## Two workflows

|                       | PROJEXA-linked survey                                                                 | Independent SampCode survey                                   |
| --------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Who asks SampAudience | PROJEXA, with the launch URL from `POST /api/surveys/{id}/sampleon/connect`           | SampCode: `POST /api/surveys/{id}/sampleon/audience-requests` |
| `source.platform`     | `PROJEXA`                                                                             | `SampCode` (`source.projectId` = SampCode project id)         |
| Progress events go to | PROJEXA                                                                               | SampCode (`POST /api/v1/sampleon/events`)                     |
| Respondent path       | card → SampAudience `/go` → `{runtime}/s/{survey}?vid=SAMPLEON&uid={token}` → outcome | same                                                          |

## In the studio

A survey's **Distribute** tab has a **SampAudience audiences** panel: **Connect to SampAudience** creates
the project's SampAudience vendor and shows the survey ID and launch link to paste into the PROJEXA
project's SampAudience tab; the form beside it asks SampAudience for an audience for this survey on its
own (description, countries, completes, incidence, LOI, reward, fieldwork dates, language,
routing); the table lists every request for the survey, PROJEXA's included, with status and
SampAudience completes.

## Survey-host contract

The project's `SAMPLEON` vendor (created by `connect` or the first request, integration
`SAMPLEON`) uses the PROJEXA adapter in `packages/redirect-core`: the browser goes back to
`{SAMPLEON}/r/{status}?token=…` and the outcome is confirmed by
`POST {SAMPLEON}/api/v1/s2s/outcome` with `HMAC-SHA256(outcome secret, token.status.timestamp)`,
through the callback outbox with retries. SampAudience counts a complete only after that confirmation
and decides any routing.

## Requests and events

`POST /api/surveys/{id}/sampleon/audience-requests` (admins and programmers):

```json
{
  "countries": ["US"],
  "requiredCompletes": 300,
  "expectedIncidence": 0.4,
  "loiMinutes": 15,
  "reward": { "points": 500 },
  "fieldwork": { "start": "2026-11-10", "end": "2026-12-10" },
  "targeting": { "naturalLanguage": "Cardiologists with at least five years of professional experience" }
}
```

`targeting.criteria` and `quotas` in SampAudience's format may be sent instead of, or with, the
description. SampAudience drafts criteria from a description; nothing is sent to respondents until a
person approves in SampAudience. `GET /api/surveys/{id}/sampleon` lists the requests and the launch
URL.

SampAudience's events are signed (`X-Sampledge-*`, client `sampleon`, the client secret) over
the raw body, deduplicated by `eventId`, and move the row through `submitted → feasibility_ready →
approved → soft_launch/live → closed`, with completes and the latest `project.quota_updated`
snapshot (by `sequence`).

## Settings

Settings → Integrations → SampAudience (stored encrypted in the database, ADR 0043): the SampAudience
address, the client ID (default `zapx`), the client secret and the outcome secret. **Test connection**
sends one signed request that cannot create anything.

## Tests

`packages/redirect-core/src/redirect.test.ts` (adapter and signature vectors shared with
`@sampledge/contracts`), `apps/api/test/sampleon.test.ts`, and SampAudience's `e2e/ecosystem/run.mjs`,
which runs both workflows with SampCode, SampAudience, SUPPLY360 and PROJEXA together.
