# ADR-0036: Correcting Topics, Prerequisites and Recall Items

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.2.4 E1: edit topics, delete prerequisite links, edit and retire recall items
- Related: ADR-0003 (sync), ADR-0026 (conflict resolution), ADR-0031 (entity deletion), ADR-0033 (source links)
- Approval: the owner approved E1 on 2026-09-27 without a feature flag, as the specification recommended.

## Context

- Before this decision, topics, prerequisite links and recall items could only be created. A topic could be deleted only while nothing referenced it.
- A typo in a topic title, a wrong answer key or a wrong prerequisite stayed forever. A wrong answer key also kept scoring every review against it.
- `quiz_attempts` reference `quiz_items`, so removing a recall item must keep its history.
- Update conflicts on these types only offered "keep remote" or "dismiss", which silently discards the local edit.

## Decision

- **Topic update**
  - `topic` accepts `update`, with the same payload as create (`space_id`, `title`, `description`) and the same validation.
  - Base version conflicts follow the note update path.
- **Recall item update**
  - `quiz_item` accepts `update` of `prompt`, `answer_key`, `explanation` and `evaluation_mode`.
  - `topic_id` cannot change.
  - Once an attempt exists, `evaluation_mode` is locked, because changing it would change how past attempts were judged. Such an update fails with `QUIZ_ITEM_MODE_LOCKED` (422, reported by sync as `SYNC_OPERATION_INVALID`).
  - Attempts keep their own recorded result; editing the answer key does not rescore history.
- **Recall item retirement**
  - `quiz_item` accepts `delete` through the ADR-0031 deletion path (capability header `entity-deletion-v1`). It is a soft delete: the item leaves the due queue and new answering.
  - Attempts, error patterns, mastery and review schedules stay unchanged.
  - Source links targeting the item are soft-deleted in the same transaction (ADR-0033).
  - A retired item no longer counts as an active reference that blocks topic deletion. Attempts still block it, as before.
- **Prerequisite deletion**: `topic_dependency` accepts `delete` through the same path. A soft delete and tombstone remove the edge from the graph.
- **Conflicts**
  - Content conflicts on `topic` and `quiz_item` offer "keep local", "keep remote" and "dismiss". Merge is not offered: the fields are short and have no three-way merge.
  - Delete-versus-update conflicts keep the existing rule: "keep remote" or "dismiss".
- **Permissions**: the same as create.
  - Shared Spaces need workspace write permission; private Spaces are the owner's.
  - Viewers and reviewers are rejected.
  - Audit events record identifiers and changed field names only.
- **No migration**: both tables already have `version` and `deleted_at`.
- **No feature flag**: the operations carry the same trust as create. Rollback is reverting the candidate.

## Interaction with source links

Editing a topic description or a recall explanation can remove the stored excerpt. The source link then falls back to comparing note versions, as ADR-0033 describes, and may show "来源已修改". This is expected and is documented in the user guide.

## Compatibility

- Pull payloads are unchanged. Retired items and deleted prerequisites arrive as tombstones.
- `pnpm test:sync-compat` covers both tombstones through the legacy client.

## Rollback

Revert the web and API candidate. Edited values are ordinary data that older builds read. Older builds simply do not show retired items and deleted prerequisites.
