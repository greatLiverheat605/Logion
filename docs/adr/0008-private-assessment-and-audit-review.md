# ADR 0008: Private assessment and audit-review state

Status: Accepted for Phase 4 L4-002

## Context

Logion needs quiz attempts, error patterns, and daily or weekly reviews without turning a
shared learning graph into a shared gradebook. These records also participate in offline
sync and may contain sensitive learning weaknesses.

## Decision

- Quiz items belong to a Space and Topic. Shared-Space creation requires
  `shared_plan.write`; any member who can read the Space may attempt an item.
- Quiz list responses never include answer keys or explanations. They are disclosed only
  to the authenticated attempt owner after an attempt has been recorded.
- Attempts are append-only personal evidence. The server derives exact-match outcomes;
  self-assessed outcomes require an explicit human choice. AI cannot submit attempts.
- Incorrect attempts may create or increment one personal ErrorPattern and make that
  person's ReviewSchedule due. This feedback never changes MasteryRecord confirmation or
  suggestion fields.
- Scores, responses, confidence, error patterns, AuditReviews, and ReviewFindings are
  filtered by authenticated `user_id`, including Pull and Bootstrap. Workspace owners and
  administrators do not receive raw personal records by default.
- AuditReview completion and ReviewFinding resolution are explicit human state changes.
  AI output can only be attached later as a draft.
- Assessment and review payloads are protected offline entities. Durable IndexedDB entity,
  Outbox, and conflict rows contain encrypted references only.

## Compatibility and recovery

`review_schedule.source` gains `quiz_error`. Existing clients preserve the protected payload
as generic sync data and the current Review UI does not branch on this source, so the addition
is protocol-compatible; compatibility tests must cover it before offline writes ship. The migration is additive. Rollback before
use can drop the new tables and restore the prior source constraint; after production data
exists, forward-fix is preferred so attempts and reviews are not discarded.

## Consequences

Group and mentor views must use a later explicit aggregate/reporting contract. They cannot
reuse personal attempt or review queries. High-stakes exam proctoring and ranking are outside
this decision.
