# Merge order for the stacked pull requests

## Current stack: Express and MongoDB (opened 2026-11-09)

MongoDB itself is on `main` already (#59, merged 2026-11-09). Three pull requests finish the move, each
built on the one before. Merge them in this order with **Create a merge commit** (after each merge, set
the next PR's base to `main` if GitHub has not done it). Each passed `pnpm check --no-docker` locally (all
348 API tests and 30 browser tests on MongoDB). #57 was an earlier MongoDB version and is closed in
favour of #59.

| Order | PR  | Branch                 | What it adds                                                                   |
| ----- | --- | ---------------------- | ------------------------------------------------------------------------------ |
| 1     | #58 | `mongodb-atlas-infra`  | MongoDB Atlas in Terraform (PrivateLink, backups), PostgreSQL data copy script |
| 2     | #60 | `express-api`          | NestJS removed: plain Express routes, one composition root, same answers       |
| 3     | #61 | `docs-express-mongodb` | Handbook, go-live guide and READMEs for Express and Atlas                      |

After the last merge, an installation that already has data in PostgreSQL is moved with the runbook in
[database.md](database.md#moving-an-existing-postgresql-installation-to-mongodb); a new installation
only needs `pnpm db:migrate` (the deploy script runs it).

## Earlier stack (merged)

> **Done.** Every PR in this table was merged into `main` on 2026-11-05 in this order, with merge
> commits, followed by #44, #45 and #46 on 2026-11-06 (`main` = `68f4531`). This page is kept as a
> record of how the stack was merged. #47 to #59 were merged after it.

The open pull requests are a stack: each one is built on the one before, so they merge one at a time
from the bottom. Every branch is rebased on the one below it, has no conflicts, and passed
`./scripts/check.sh --quick` locally. The full browser suite (`e2e/`) passed on the top branch,
which contains all of them. There is no CI on this repository, so these local checks are the only
checks.

| Order | PR  | Branch                         | What it adds                                                                 |
| ----- | --- | ------------------------------ | ---------------------------------------------------------------------------- |
| 1     | #27 | `quantum-design-system`        | Quantum Design System and theme engine                                       |
| 2     | #29 | `neon-ai-dashboard`            | Neon AI theme, sidebar shell and dashboard                                   |
| 3     | #30 | `blueprint-p1-core`            | Blueprint phase 1: loops, blocks, variables, programmer workspace, bank      |
| 4     | #31 | `blueprint-p2-ai-multilingual` | Blueprint phase 2: multilingual tools, URL variables, least fill, test cases |
| 5     | #32 | `blueprint-p3-fieldwork`       | Blueprint phase 3: fieldwork evidence, supervision, appeals, email           |
| 6     | #33 | `blueprint-p4-research`        | Blueprint phase 4: MaxDiff, conjoint, recodes, AI research assistant         |
| 7     | #34 | `blueprint-p5-enterprise`      | Blueprint phase 5: automation, residency, cleaning, dashboards, SMS          |
| 8     | #35 | `docs-handbook`                | Maintainer handbook                                                          |
| 9     | #36 | `security-fixes`               | Security fixes: vendor secret, password change and reset, AWS secret list    |
| 10    | #37 | `blueprint-p6-eye-tracking`    | Webcam eye tracking (experimental, not validated on real webcams)            |
| 11    | #38 | `stack-integrations-in-crm`    | Brings #28 (integrations in the CRM) onto the stack, with conflicts resolved |

## How to merge

1. Merge with **Create a merge commit**, not **Squash and merge** or **Rebase and merge**. Both of those
   give `main` new copies of the commits, so the next PR in the stack would show conflicts.
2. Merge #27 into `main`. Then open #29: if GitHub has not moved its base to `main` by itself
   (it does when the merged branch is deleted), press **Edit** next to the title and set the base to
   `main`. Then merge it. Repeat for each PR in the table.
3. **#28 is not merged on its own.** Its branch was made from an older `main` and conflicts with the
   stack. #38 contains all of #28's commits with the conflicts resolved, so once #38 is merged,
   GitHub shows #28 as merged. If it does not, close #28.
4. After the last merge, run the database migrations on each environment (the deploy script does
   this). At the time this was PostgreSQL's migrations; since #59 it is the MongoDB collections and indexes.

## Not part of the stack

The Dependabot pull requests (#20 to #25) were closed: PR #44 made the same changes (Node 26 LTS,
`nginx:1.31-alpine`, newer GitHub Actions steps) and passed the full check on Node 26.

## Still waiting on something else

- SampBidx waits for its API documentation; nothing is built for it.
- Eye tracking is experimental. It is opt-in and marked as not validated in the editor, on the
  respondent screen and in Analysis (ADR 0034). Try it with a few real respondents before relying on
  it.
