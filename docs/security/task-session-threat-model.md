# Task and study-session threat model

Status: L3-002A implementation baseline

## Protected assets and invariants

- Every task and session is scoped to a Workspace and Space. The server derives access from the
  authenticated membership and never trusts a client-side authorization decision.
- Private Spaces remain owner-only; writes in Shared Spaces require the canonical shared-plan
  write permission.
- Task completion is not evidence of mastery. Ordinary task transitions cannot enter `verified`
  or `done`; L3-004 verification is the only planned path through that gate.
- Completing or abandoning a study session never completes its task.
- At most one active session exists per user and Workspace. A Workspace row lock serializes the
  check, and a PostgreSQL partial unique index provides a second enforcement layer.
- Descriptions and reflections are user content. Reflection text is stored on the session but is
  excluded from session-event and audit metadata.

## Trust boundaries and controls

| Boundary            | Threat                                  | Control                                                                                                   |
| ------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Browser to API      | CSRF or untrusted cross-origin write    | HttpOnly session cookie, trusted Origin validation, double-submit CSRF token                              |
| DTO to domain       | Over-posting, invalid state, naive time | Strict Pydantic models, bounds, timezone-aware timestamps, explicit state machine                         |
| User to Workspace   | Cross-tenant object reference           | Membership, Workspace and Space resolution before scoped queries; not-found response for hidden resources |
| Concurrent writers  | Lost update or duplicate active session | Expected versions, row locks, partial unique index                                                        |
| API to database     | SQL injection or identifier collision   | SQLAlchemy expressions and parameter binding; client UUID collision checks and database constraints       |
| Audit pipeline      | Sensitive reflection leakage            | Metadata allowlists contain identifiers, status, outcome and duration only                                |
| Resource exhaustion | Task or write flooding                  | Per-goal task quota and per-user/Workspace execution-write rate limit                                     |

## Negative and compatibility tests

- Missing CSRF, stale versions, invalid transitions and blocked tasks without a reason are rejected.
- Cross-tenant and Private Space access is denied without revealing the protected object.
- A second active session is rejected, and completing a session leaves the task `in_progress`.
- Migration tests must cover empty database upgrade, upgrade from `0010_planning_core`, downgrade,
  PostgreSQL constraints and the active-session partial index.
- OpenAPI and generated TypeScript contracts are regenerated in the same change.

## Residual risks and follow-up

- L3-002B must encrypt task descriptions and session reflections in the protected offline vault;
  entity and Outbox rows may contain only encrypted payload references.
- L3-004 must implement evidence submission and human verification before enabling transitions to
  `verified` and `done`.
- Operational metrics should use counts and latency only; they must not include task titles,
  descriptions or reflections.
