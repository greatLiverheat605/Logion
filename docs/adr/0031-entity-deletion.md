# ADR-0031: Core Entity Soft Deletion and Tombstone Synchronization

- Status: Accepted
- Date: 2026-09-06
- Scope: T-05 / ISSUE-010, Goal, Note, Task and plain Note external URLs
- Related: ADR-0003, ADR-0004, ADR-0025, ADR-0026
- Approval: owner selected option 3 on 2026-09-06 — deletion is refused while a
  retained record still references the Note. No Evidence content snapshot is
  introduced, and no Note is deleted out from under a live reference.

## Context

Goal, Task, StudySession, Note and Resource already have nullable `deleted_at`
and integer versions. Sync-v1 supports delete envelopes and tombstone changes,
but no domain delete handlers are registered. The following handoff assumptions
do not match the implementation baseline:

- Pull is implemented in `sync/read.py`, not `sync/service.py`. The latter owns
  the transactional ledger. Pull visibility currently excludes deleted rows.
- Note and Resource reference Task through `task_id`; neither directly owns a
  `goal_id`. Resource has no `note_id`, so there is no Resource-to-Note reference
  to clear. Adding such a relationship is not part of this proposal.
- EvidenceItem contains `summary`, `note_id` and `resource_id`, but no immutable
  Note-body snapshot. Retaining Evidence rows does not preserve readable Note
  content after deletion. Its shape constraint forbids clearing `note_id` while
  `evidence_type` remains `note`.
- KnowledgeCitation also carries a nullable `note_id`, with an active-note index
  and a unique constraint both predicated on `status = 'active' AND note_id IS
NOT NULL` (`knowledge_space/models.py:296-315`). It is a second referencing
  entity and is subject to the same refusal rule as EvidenceItem.
- LearningPlan, PlanVersion and PlanPhase have no `deleted_at`; they are carried
  within the Goal sync aggregate, not independent sync entities.
- The push operation has no `deleted_at` field. LocalMutationInput has one, and
  pull Change has one. Strict wire schemas reject unregistered envelope fields.
- ProtectedOfflineRepository currently replaces all payloads with Vault
  references, which violates the empty delete payload constraint. Pull only
  protects entities whose sync status is `pending`, not existing conflicts.

## Proposed Decisions

### Soft Deletion and Cascade Boundary

No physical rows, attachment bytes or historical evidence are purged by T-05.
Each deleted sync entity receives server-authoritative `deleted_at`, a version
increment, actor/time metadata and an empty-payload tombstone in the same
transaction. Existing deleted descendants are not repeatedly version-bumped.

The proposed cascade is scoped by authenticated Workspace and writable Space:

| Root | Proposed effect                                                                                                                                              | Retained records                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Goal | Soft-delete its Tasks and those Tasks' Notes, Resources and StudySessions                                                                                    | Plan/version/phase history and Evidence/Verification history                   |
| Task | Soft-delete its StudySessions; clear `task_id` on retained Notes and Resources with versioned sync updates                                                   | Notes, Resources and Evidence/Verification history                             |
| Note | Refuse deletion while an active EvidenceItem or KnowledgeCitation references it; otherwise soft-delete the Note and invalidate its local document projection | Every referencing record, untouched; no fictitious Resource reference clearing |

An active session must become abandoned with an end time when tombstoned, so
the current unique active-session index does not prevent starting future work.
Goal plan history becomes inaccessible through the deleted root without adding
independent plan/phase tombstones or a schema migration just for those rows.

Permissions match the existing domain writable-Space checks, including shared
write policy. Cascade permission failures reject the entire operation. Child
identifiers/counts must not leak across visibility boundaries. New child writes
and Note document updates must reject deleted parents; concurrency checks must
cover both sync and existing online domain paths.

### Conflict Semantics

There is no LWW for delete/update races. A stale delete or an update against a
tombstoned identity returns a durable `delete_update` conflict after authorization,
not an apparent success or generic unsupported-operation response. The local
work remains recoverable in the encrypted Vault.

Pulling a tombstone with unsent local work, including `note_document_update`,
must mark the related Outbox work and entity as conflict. A subsequent pull
page must not overwrite that unresolved local version or its encrypted payload.
Accepting the remote deletion is an explicit conflict-center action, not a
normal payload merge. Keep-local must not silently restore a deleted identity;
copying supported content to a new identity can preserve it instead. Local-only
pull conflicts remain distinct from server-recorded conflicts under ADR-0026.

The implementation must make tombstone metadata unambiguous to the conflict
center, including after restart. Any necessary additive contract fields require
matching backend schemas, JSON Schema, generated types and validation tests;
an empty object must not accidentally be treated as a live restored record.

### Outbox and Ledger

- Local delete input: `{}` payload, non-null client `deleted_at`, current known
  `base_version`, next local revision and a fresh operation ID.
- The wire retains the current sync-v1 envelope: no invented `deleted_at` push
  field. Server deletion time is assigned when applied and returned by Pull.
- A delete payload remains `{}` even for protected entities. Keep any recoverable
  local content encrypted separately; never replace the wire payload with a
  Vault reference or persist plaintext to make delete validation pass.
- Causal dependencies may use an actually applied predecessor version, never
  blindly adopt the latest server version and bypass another device's edit.
- Root mutation, cascades, child sync changes, idempotency records and audit
  impact summary commit atomically. Derived operations use deterministic IDs
  scoped to the root operation. Duplicate delivery cannot repeat the cascade.
- Pull authorizes tombstones using retained rows and current Space visibility.
  Enabling tombstones must not expose old payloads for deleted entities or bypass
  membership/Space checks. Bootstrap excludes deleted live records.
- Impact counts are part of the deletion result/audit, not tombstone payloads.
  Any response contract addition must preserve strict sync validation.

No new deletion-specific feature flag is proposed; existing authentication,
shared-write and production enablement boundaries remain unchanged. No production
capability is enabled by this task.

### User Interface

Use the actual workbenches: planning-workbench, records-workbench and
today-workbench. The latter two replace the nonexistent handoff file names.
Inspector delete actions use AppModal with initial focus on Cancel. The dialog
lists the full cascade policy and available scoped counts, distinguishing local
estimates from authoritative server counts. It must not promise preservation of
Note-body snapshots that do not exist.

Close the selected Inspector and refresh after local commit; say deletion is
queued until ACK/Pull completes. Network rejection, conflict and incomplete
cascade synchronization remain visible through inline status and feedback.error.
Do not advertise a full server deletion merely because IndexedDB committed.

### Note External URLs

Preserve ProductMarkdownPreview's existing escaped-text policy and structural
formatting. A separate Note-only external-link component may list standalone
HTTP/HTTPS URLs from the text. It uses the URL parser plus a protocol allowlist,
opens with `target="_blank"` and `rel="noopener noreferrer"`, and labels the
external navigation. Markdown `[text](url)` and HTML are never interpreted as
link syntax. JavaScript, data, file, protocol-relative and malformed URLs are
not links. This independently approved portion need not wait for deletion policy.

## Owner Decision (settled 2026-09-06)

Option 3 was selected: refuse the deletion while a retained record still
references the Note. Options 1 (accept an unreadable-body Evidence trail) and 2
(add immutable content snapshots) were rejected — the first leaves summaries
whose source can no longer be read, and the second expands T-05 with a
retention/migration design and a snapshot-consistency rule of its own.

The refusal rule:

- A Note is undeletable while an active `EvidenceItem.note_id` or an active
  `KnowledgeCitation.note_id` points at it. "Active" means the referencing row is
  not itself soft-deleted, and for citations means `status = 'active'`.
- The check runs inside the same transaction as the delete, before any write.
  Refusal rejects the whole operation and mutates nothing.
- A Goal or Task cascade that would reach such a Note is refused as a whole. A
  cascade must not partially apply and must not silently skip the blocked Note.
- The refusal returns a distinct, non-retryable error code with a scoped count of
  blocking references. It must not leak identifiers or titles across a visibility
  boundary the actor cannot already read.
- The confirmation dialog surfaces the blocker before the user commits, and tells
  them to detach the references first. This follows the same principle as
  ADR-0003/ADR-0026 delete conflicts: a human resolves it, the system does not
  quietly manufacture a gap in the evidence chain.

This keeps Goal and Task deletion fully in scope. Only Notes that are actually
cited are affected, which in a ≤10-user deployment is a small, tractable set.

## Verification Required

- Goal/Task/Note deletion, empty tombstones, cascade atomicity, replay and quotas.
- Refusal rule: a cited Note is refused and nothing is written; an uncited Note
  deletes normally; a Goal/Task cascade reaching a cited Note is refused whole,
  with no partial application; soft-deleted EvidenceItem rows and non-active
  KnowledgeCitation rows do not block; the error carries a count but no
  cross-boundary identifiers.
- Two devices: delete then pull; update/delete races in both directions;
  pending and already-conflicted Outbox preservation across multiple pull pages.
- Note Yjs pending updates cannot resurrect deleted text or silently disappear.
- Private/shared Space authorization and cross-Workspace negative cases.
- Local delete input and Outbox validation, Vault confidentiality, explicit
  remote-deletion resolution, dependency chains and restart persistence.
- Three confirmation dialogs, Cancel focus, correct counts, truthful offline/
  rejection/conflict feedback and closed Inspector behavior.
- Safe URL rendering, blocked schemes, no HTML/Markdown link execution,
  long-link wrapping, browser planning/records/today regression.
- API pytest/Ruff/mypy, offline/Web tests and type checks, production Web build,
  generated-contract drift check. API is Python, so the handoff's nonexistent
  `pnpm --filter @logion/api test/build` commands must not be reported as passed.

## Follow-up Work

- Add safe garbage collection for `vaultRecords`. Pull stores encrypted remote
  payloads under `change.operation_id`, not `entity_id`, to avoid overwriting an
  in-flight local edit. Keep this isolation: current cleanup supports only
  individual operation deletion or a whole-Vault clear, so repeated pulls of an
  entity accumulate old slots. Future collection must preserve every slot still
  referenced by entities, pending Outbox work, unresolved conflicts or recoverable
  Note documents, including concurrent edits and pulls. Growth is slow in the
  current deployment of at most 10 users; collection is deferred beyond T-05.
