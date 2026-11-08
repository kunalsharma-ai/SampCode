# 0039: Bidzo is renamed SampBidx and SAMPLEON is renamed SampAudience

Status: Accepted (2026-11-08)

## Context

The owner renamed two Sampledge products: the bidding platform Bidzo is now **SampBidx** and the audience,
invitation and routing engine SAMPLEON is now **SampAudience**. The studio already showed SampAudience with its
logo (PR #51); the docs and handbook still used the old names. SampCode has no SampBidx integration yet, so
SampBidx appears only in docs. SAMPLEON is also built into identifiers that the partner and stored data rely on.

## Decision

1. **Text people read says SampBidx and SampAudience:** studio and API messages, the current docs (module and
   operations guides, blueprint parity, brand guide, handbook) and the handoff documents.
2. **Identifiers keep SAMPLEON**, as ADR 0038 did for `zapx`: the vendor code and integration value, `SAMPLEON_*`
   environment variables, API paths, the service client id, event `source` value, database tables, code names
   and the partner repository name. The list is in `docs/brand/README.md`.
3. **History is not rewritten.** ADRs 0001 to 0038 and past changelog entries keep the names they were written with.

## Consequences

- No migration, configuration change or partner change is needed. Migration `20261122000000_sampaudience_vendor_name`
  (PR #51) already renamed the display name of existing SampAudience vendors.
- A future SampBidx adapter should use SampBidx for its user-facing name; its identifiers can be chosen with the
  partner's API contract.
