# AI gateway

Decision: [ADR 0004](../adr/0004-ai-gateway.md) · Code: `apps/api/src/ai`

## Using it

```ts
const result = await gateway.run('translate', { tenantId, userId }, (model) => provider.translate(req, model), { surveyId });
```

`run` checks configuration, tenant permission, rate limits, budget and the circuit breaker, calls the
provider with the task's model, then records tokens, cost and outcome in `AiUsage` and an
`ai.<task>.<outcome>` audit event. Errors are `AiError` with a code the studio can explain:
`NOT_CONFIGURED`, `NOT_PERMITTED` (403), `RATE_LIMITED` / `BUDGET_EXCEEDED` (429), `CIRCUIT_OPEN` /
`UNAVAILABLE` (503), `REFUSED`, `BAD_OUTPUT`, `TOO_LONG` (422).

## Tasks

| Task        | Used by                              | Model setting                     | Input redaction                                      |
| ----------- | ------------------------------------ | --------------------------------- | ---------------------------------------------------- |
| `architect` | AI Survey Architect, document import | Architect model → default model   | brief and text documents (PDFs are sent as they are) |
| `translate` | Language Studio                      | Translation model → default model | none (survey texts are the product)                  |

## Settings

Installation (Settings › Integrations › Claude, stored encrypted in the database; ADR 0043): the API
key, the default model, optional models per task and the price table (USD per million tokens per
model). Server environment (no keys): `AI_PROVIDER`, `AI_MAX_RETRIES`, `AI_TIMEOUT_MS`,
`AI_BREAKER_FAILURES`, `AI_BREAKER_OPEN_MS`, `AI_DEFAULT_RPM`, `AI_DEFAULT_RPD`.

Organization (Settings › AI, administrators): on/off, allowed tasks, requests per minute and per
day, monthly budget, redaction; this month's usage and cost.

## Adding a provider

1. Subclass `AiProvider` (set `name`), implement `architect` and `translate` with structured output
   and map errors to `AiError`.
2. Add the name to `AI_PROVIDER` in `config.ts` and a case in `DynamicAiProvider`
   (`apps/api/src/ai/dynamic-ai.provider.ts`).
3. Add its models to the price table in Settings › Integrations, and its key fields to
   `apps/api/src/platform/integrations.ts`.
