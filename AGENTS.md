# Repository contributor contract

These rules apply to automated contributors working in this repository.

## Start with the project

Read [CONTRIBUTING.md](CONTRIBUTING.md), the [development guide](docs/development/README.md),
and the architecture or security documents relevant to the change. Use source code,
applicable tests and the user's current instructions as the source of truth.

## Preserve ownership and data

- Inspect the branch, HEAD and working tree before editing. Preserve unrelated and unexplained changes.
- Use one writer per branch/worktree. Give parallel reviewers explicit, non-overlapping responsibilities.
- Never reset, clean, stash, commit or overwrite another contributor's changes without authorization.
- Keep credentials, provider endpoints, private host configuration, personal data and machine-specific
  paths out of source, test fixtures, documentation and logs.
- Keep work notes, agent plans and generated reports local or in CI artifacts. Commit reusable source,
  tests, synthetic fixtures and maintained documentation.

## Verify and deliver

- Keep changes within the requested scope. Run the smallest relevant checks and required CI gates.
- Report checks as passed only after observing their results. Record skipped checks and limitations.
- Update user instructions when behavior changes and configuration guidance when setup changes.
- Review API, migration, authorization, offline/sync and recovery impact before integration.
- Commit, push and merge only within the user's authorized scope. Deployments, data destruction,
  external messages and sensitive feature enablement need explicit authorization.
- Preserve historical evidence; do not rewrite shared Git history to hide superseded decisions.

The optional local coordination validator and its synthetic fixtures are documented in
[AGENT_STATE_MODEL.md](docs/development/AGENT_STATE_MODEL.md). Real coordination state is ignored
and is not part of the public repository.
