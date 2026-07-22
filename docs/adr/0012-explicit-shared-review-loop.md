# ADR 0012: Explicit shared review and report loop

Status: Accepted for Phase 4 L4-G1

## Decision

- Rubric, ReviewRequest, GroupFeedback, and ReportSnapshot exist only in a user-created
  `shared` Space. No supervisor, group, course, subject, or review context is preinstalled.
- Owner, Admin, and Editor use `shared_plan.write` to create rubrics, review requests, and
  report snapshots. Reviewer uses `review.write` to append feedback. Viewer is read-only.
- Every parent lookup is constrained by Workspace and Space. Shared roles never grant access
  to a member's private Space or personal exam, self-study, research, note, or mastery rows.
- ReportSnapshot is an immutable, user-authored projection: it has create and read paths but
  no update or delete path. It is not an automatic aggregation of personal records.
- The four payload types are Vault-protected offline entities. Sync preserves the same server
  authorization as REST and records explicit parent-operation dependencies.
- AI has no formal write path for rubric, review, feedback, or report records.

## Compatibility and recovery

Migration 0022 is additive. Disabling the UI or routes leaves stored shared records intact.
After production data exists, schema corrections use a forward migration; rollback must not
drop shared review history without an explicit, verified export and retention decision.
