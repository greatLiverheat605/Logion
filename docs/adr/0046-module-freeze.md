# ADR-0046: Freezing Exam, Self-Study, Template and Shared Review Modules

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.3
- Freezes: ADR-0009 (exam context), ADR-0010 (self-study loop), ADR-0012 (shared review loop), ADR-0017 (templates and shares)
- Approval: in the 2026-09-27 kickoff the owner said these modules had never been used and chose to freeze them (D4).
- Accepted: the owner reviewed and accepted this record on 2026-09-27 (PR #269).

## Decision

- **Kept.** Tables, API endpoints, exports and backend tests stay as they are.
- **Hidden.** The v0.3 client has no entry to them, because their pages depend on the offline layer that ADR-0038 retires. Their legacy pages are removed with the legacy client in v0.3.1.
- **Not developed.** No new features are built for them.
- **Unfreezing.** It needs a new ADR, and the module is rebuilt on the v0.3 shell.
- **Existing data.** Production holds one or two rows per module. They are exported for the owner to review before the release and are kept in the database.

## Rollback

Not applicable: nothing is deleted.
