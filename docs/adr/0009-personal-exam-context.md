# ADR 0009: Personal exam context and derived countdown

Status: Accepted for Phase 4 L4-E1/L4-E2

## Context

Logion needs a user-configured exam context for long-running study plans. Exam names,
dates, time zones, and target scores are sensitive personal planning data. A Space can be
shared, but that must not turn it into a shared exam dashboard or disclose a learner's
target to a Workspace owner.

## Decision

- An Exam belongs to one Workspace, Space, and authenticated user. The `user_id` boundary
  applies to REST list, Pull, and Bootstrap even when the Space is shared. Workspace owner
  or administrator roles do not grant access to another user's Exam.
- Empty accounts receive no predefined exam, date, target, institution, mentor, or group.
  Every Exam is created from user input and can later be deleted or archived.
- `scheduled` requires a timezone-aware instant and a valid IANA time-zone identifier.
  `undetermined` has no instant. A target and score-scale maximum are either both absent or
  both present, and the target cannot exceed the scale.
- The countdown is a client-side projection of the stored instant and the current clock.
  It never writes a derived number of days or silently changes formal Exam status.
- Exam payloads are protected offline entities. Durable IndexedDB entity, Outbox, and
  conflict rows contain Vault references, while Sync Push carries plaintext only in the
  authenticated request.
- Subject and SyllabusNode inherit the Exam's personal owner boundary. Subject weights use
  basis points and cannot total more than 100 percent for one Exam. New syllabus nodes may
  reference only an existing parent in the same Subject, so create-only hierarchy writes
  cannot introduce cycles.
- Syllabus coverage begins at `not_started`. A later explicit user transition may change
  it; create payloads and AI output cannot forge another coverage state.
- AI may explain or propose planning drafts in later work, but it cannot create, modify,
  complete, archive, or retarget an Exam without an explicit user action.

## Compatibility and recovery

The database migration, REST endpoints, and sync entity type are additive. Older clients
preserve unknown sync records according to the generic protocol but cannot edit Exams.
Before production data exists, rollback may remove the table and route. After data exists,
use a forward fix or feature disablement so personal records are not discarded.

## Consequences

Shared, mentor, and group dashboards need a future explicit consent and aggregation
contract. They cannot reuse the personal Exam query. Arbitrary user-selected display time
zones and Exam update/delete transitions are separate vertical slices.
