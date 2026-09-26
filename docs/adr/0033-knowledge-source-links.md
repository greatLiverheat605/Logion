# ADR-0033: Knowledge Source Links

- Status: Accepted
- Date: 2026-09-26
- Scope: navigable links from a note selection to the topics and recall items created from it
- Related: ADR-0003 (sync), ADR-0004 (Workspace and Space permissions), ADR-0025 (Yjs note stream), ADR-0031 (entity deletion)
- Approval: the owner approved the proposed draft on 2026-09-26, including non-blocking note deletion. Evidence items citing topics stay out of scope.

## Context

- "选段用于复习" turns a note selection into a topic or a self-assessed recall item.
  - Before this decision the source was kept only as text (`来源笔记：<title>` plus the excerpt) inside the topic description or the recall explanation.
  - The app could not navigate back to the note, list what a note produced, or tell whether the source changed or disappeared.
- `TopicCreateRequest` and `QuizItemCreateRequest` are strict. Adding source fields would change two contracts and the encrypted payloads of existing items.
- ADR-0031 blocks note deletion while evidence or citations reference it. A source link is a navigation aid, not evidence, so it must not block deletion.

## Decision

- **New append-only sync entity `source_link`** (table `knowledge_source_links`, migration `0042_knowledge_source_links`).
  - The client creates it in the same Outbox batch as its target, depending on the target operation and on the latest pending operation of the note.
  - Fields:
    - `id`, `workspace_id`, `space_id`;
    - `source_kind`, fixed to `note`;
    - `source_id`;
    - `target_kind`, one of `topic` or `quiz_item`;
    - `target_id`;
    - `excerpt_sha256`;
    - the optional pair `excerpt_start` and `excerpt_end`, set only when the excerpt occurs exactly once in the saved note;
    - `source_version`, the note's server version at capture (0 before its first sync);
    - `version`, audit columns and `deleted_at`.
- **No excerpt text in the link.**
  - The excerpt stays inside the encrypted topic or recall-item payload.
  - The server stores only the digest and the offsets.
  - The audit event `memory.source_link_created` records the Space ID and the target kind only.
- **Same Space only.**
  - The source note and the target must exist, not be deleted, and belong to the link's Workspace and Space. Otherwise the create is `SOURCE_LINK_INVALID` (422), which sync reports as `SYNC_OPERATION_INVALID`.
  - Pull and bootstrap follow the Space read rule (shared Space or owner), so revoked access hides the link together with its source.
- **Lifecycle**
  - Links are never edited.
  - Deleting the target topic soft-deletes its links and emits their tombstones in the same transaction. Recall items have no delete path yet.
  - Deleting the source note is **not** blocked. Links remain and the client shows "来源已删除".
- **States derived on the client.** The server never computes over note text.
  - **deleted**: the note is tombstoned.
  - **unavailable**: the note is not in the local store.
  - **valid / modified**: when the target still holds an excerpt whose digest matches, the state is valid if the current note text contains it, otherwise modified.
    - Recall items pulled from the server carry no explanation. For them, and for edited targets, the state compares note versions instead: at or below `max(source_version, 1)` is valid, anything newer is modified.
- **Location**
  - "打开原文" navigates with IDs only (`workspace`, `space`, `note`, `source`).
  - Records selects the note and highlights the excerpt by text search first, because Yjs edits shift offsets. It then falls back to the captured range, and finally to the top of the note.
- **Feature flag** `LOGION_SOURCE_LINKS_ENABLED`, default `false`, forwarded by Compose.
  - With the flag off, the server rejects `source_link` creates and the UI hides the "来源" and "由此创建" sections.
  - `GET /api/v1/workspaces/{workspace_id}/spaces/{space_id}/source-links/capabilities` reports the flag to readers of the Space. Offline, the client keeps the last known value.
  - Nightly and Release enable the flag so the authenticated browser gate exercises the flow.
  - Text-only provenance keeps working either way.

- **Portability**
  - Workspace exports include live `knowledge_source_links` rows of the Spaces the requester can read.
  - Account deletion keeps shared rows with their pseudonymized author, like topics. Deleting a Space or Workspace cascades.

## Compatibility

- The fixed legacy client (`37e2e00`) validates `entity_type` as a plain string and stores unknown types generically. `pnpm test:sync-compat` pulls a `source_link` change and its tombstone through that client.
  - The legacy client stores the link payload unencrypted. The payload holds only identifiers, offsets and a digest.
- The current client encrypts `source_link` like the other protected entities.
- Topic and recall-item contracts are unchanged. Items created before this change simply show no source.

## Rollback

Turn the flag off. Creates are refused and both UI sections disappear. Existing rows stay and remain readable through pull; the migration is forward only.
