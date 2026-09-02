# Workbench v1 Contract Baseline Amendment

Date: 2026-08-20
Status: Product Owner approved for contract correction; implementation gates remain separate.
Base: `2ff1f0767c8b393529077da658eb9d1e3f271a5d`

## Approved decisions

- Definition summary and detail responses expose server-generated `ownerUserId`; client requests cannot submit or override it.
- This amendment adds an owner field only to Definition responses. The existing server-generated Link response `ownerUserId` remains unchanged.
- A recoverable import failure before the commit point returns `503` with `retryable=true` and creates no receipt.
- A terminal failed import uses the existing failed receipt with `retryable=false`.
- The seven target kinds are `task`, `source`, `topic`, `note`, `evidence`, `claim`, and `project`.
- `source` is resolved only through the approved Resource resolver.
- `linkSetRevision` is persisted on the Workbench Definition row and atomically advanced with Link mutations.
- The production Feature Flag controls route registration and remains default-off.

## Authorized scope

- Correct the C1-C5 contract wording and C5 response schema.
- Regenerate and verify OpenAPI/type snapshots after the schema change.
- Keep database, migration, real API wiring, quota, threat-model, Preference migration, production configuration, flag enablement, commit, push, merge, and deploy out of this task.

## Next gate

After the contract correction passes independent review and `contracts:check`, create a clean isolated C6-M worktree for migration/models. C6-M must implement the Definition-row `link_set_revision` field and upgrade/downgrade tests without changing the contract files.
