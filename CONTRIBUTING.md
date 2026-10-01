# Contributing to LiveCoco

## Before changing code

Read the relevant domain documentation. Price, identity, verification and deal rules are product integrity controls, not ordinary presentation details.

Create or update an Architecture Decision Record when a change:

- Introduces a new infrastructure dependency.
- Changes ownership between modules.
- Alters money, quantity or unit semantics.
- Changes price provenance or aggregation.
- Changes an externally visible state machine or API contract.
- Expands collection or exposure of personal data.
- Introduces platform-managed payments, credit or logistics guarantees.

## Branch and pull-request expectations

- Keep changes focused and independently reviewable.
- Include tests proportional to the risk.
- Update documentation in the same change.
- State migration and rollback implications.
- Identify new configuration and secrets.
- Attach screenshots for visible UI changes in Tamil and English.
- Do not include real farmer, buyer, phone, identity or transaction data in fixtures.

## Commit guidance

Use imperative, outcome-oriented commit subjects, for example:

```text
Add source freshness to public price responses
Prevent offers against expired sell lots
Document copra moisture normalization rules
```

## Domain invariants

- Accepted offers and deal cards are immutable; corrections create revisions.
- Original price-source payloads are append-only.
- Public aggregates never mix incompatible product, grade, market-stage or unit buckets.
- Per-nut and per-weight prices are not converted without observed lot weight.
- A user cannot grant themselves verification or operational permissions.
- Exact pickup coordinates are not public listing fields.
- Every privileged action produces an audit event.

## Quality gates

Before merging application code, the repository should pass:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm docs:check
```

Application packages have not yet been generated, so the first implementation change must replace the placeholder root scripts with real workspace scripts.

## Database changes

- Use forward-only, reviewed migrations.
- Avoid destructive column removal in the same release that stops writing it.
- Backfill asynchronously when the table could be large.
- Add constraints only after invalid historical rows are resolved.
- Preserve raw source and audit tables.
- Describe recovery steps for every migration with material risk.

## Localization

- English source text must use stable message keys.
- Tamil translations require human review.
- Never concatenate translated fragments to construct sentences.
- Numbers, dates, money and units must be locale-aware while preserving the underlying value.
- Error messages should explain the next action, not expose internal exceptions.

## Security

Do not open public issues containing vulnerabilities or personal data. Follow [SECURITY.md](./SECURITY.md).

