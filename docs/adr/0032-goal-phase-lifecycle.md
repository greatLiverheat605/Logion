# ADR-0032: Goal Phase Lifecycle

- Status: Accepted
- Date: 2026-09-26
- Scope: append, edit, reorder, archive, unarchive and protected removal of phases on an existing goal
- Related: ADR-0003 (offline sync protocol), ADR-0026 (conflict resolution), ADR-0031 (entity deletion)
- Approval: the owner selected option A (revise the current plan version in place) on 2026-09-26.

## Context

- A goal's phases are rows of its latest `PlanVersion`, not independent sync entities. Pull carries them inside the `learning_goal` payload.
- Before this decision, sync registered only `create` and `delete` for `learning_goal`, so an existing goal could never gain or change a phase.
- `tasks.phase_id` references `plan_phases` with `ON DELETE RESTRICT`. `(plan_version_id, position)` is unique and non-deferrable.

## Decision

- **Migration** `0041_plan_phase_archived_at` adds a nullable `plan_phases.archived_at`. Downgrade drops it; export any archived rows first.
- **Sync update**
  - `learning_goal` accepts `update`. Clients send their full goal payload; the server reads only `phases`, so goal fields are not revisable in this scope.
  - Each phase carries `id`, `title`, `description`, `estimated_minutes`, `acceptance_criteria`, `archived` and `removed`. The list order is the new position. The `position` and `archived_at` values that clients mirror from their stored payload are accepted and ignored.
  - Every existing phase must appear in the list; a missing phase is `SYNC_OPERATION_INVALID`.
  - New phases carry client-generated IDs.
  - At least one phase must stay active.
- **Removal**
  - Removal is explicit (`removed: true`) and only allowed when no task, including soft-deleted history, references the phase.
  - A referenced phase is rejected (`PLANNING_PHASE_REFERENCED`, surfaced as `SYNC_OPERATION_FORBIDDEN`) and can only be archived.
- **Transaction**
  - The server applies the revision in one transaction and moves kept rows out of the unique position range before writing final positions.
  - It bumps `goal.version` and records the audit event `planning.phase_revised`. The audit metadata holds only the Space ID and counts, never text.
- **Conflicts**
  - The causal base version follows the note update path.
  - A stale version raises `RESOURCE_VERSION_CONFLICT` and becomes a sync conflict carrying the remote goal payload.
- **Pull payload**: `goal_payload()` now includes `archived_at` per phase. Older payloads without it are read as not archived.
- **Feature flag**: `LOGION_PLANNING_PHASE_REVISION_ENABLED`, default `false`, forwarded by Compose.
  - With the flag off, updates are rejected as `FEATURE_DISABLED`.
  - `GET /api/v1/workspaces/{workspace_id}/spaces/{space_id}/goals/capabilities` reports the flag to readers of the Space.
  - The web client shows "编辑路线" only when the flag is on, and keeps the last known value while offline.
  - Nightly and Release enable the flag so the authenticated browser gate exercises the feature.
- **Web**
  - The route editor edits, appends, reorders with "上移/下移" buttons (keyboard operable), archives, unarchives and removes phases, and disables removal for referenced phases.
  - Archived phases leave the route and appear in a collapsed "已归档阶段" group with their task counts.
  - A cached older client would show archived phases as active until reload. This is display-only.

## Rejected alternative

Publishing a new `PlanVersion` per revision with a `lineage_id` would keep richer history, but tasks would point at superseded rows. That would need remapping in pull, the UI and analytics, plus a larger migration.

## Rollback

Turn the flag off: updates are refused and the UI returns to read-only. Data and the migration stay (forward only).
