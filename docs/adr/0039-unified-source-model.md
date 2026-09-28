# ADR-0039: Unified Source Model

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.3 literature library
- Amends: ADR-0011 (personal research evidence), ADR-0029 (adaptive knowledge space)
- Approval: part of the v0.3 plan, approved by the owner on 2026-09-27.
- Accepted: the owner reviewed and accepted this record on 2026-09-27 (PR #269).

## Context

- **Papers.** `PaperRecord` holds only a title, a citation key and a URL. It has no authors, year, DOI, venue, abstract, tags or Zotero identity.
- **Materials.** `Resource` (`link`, `pdf_index`) holds materials, and `SourceExcerpt` already references it by foreign key.
- **Overlap.** Papers and materials are two models for one thing, so excerpts and citations cannot point at a paper.
- **Production data.** On 2026-09-27 production has no `paper_records` and no `resources` rows.

## Decision

- **Evolve `resources`.** It becomes the single source entity; no new table is added. All new columns are nullable or defaulted:
  - `resource_type` adds `paper`, `book`, `preprint` and `web`;
  - `csl` (JSONB): a CSL-JSON subset covering authors, issued date, container title, volume, issue, pages, abstract and language;
  - identifiers `doi`, `arxiv_id` and `pmid`, each unique per Space and owner when present on a live record, used for deduplication;
  - `citation_key` and `tags`;
  - Zotero mapping `zotero_library_id`, `zotero_item_key` and `zotero_version`;
  - `file_locator` (JSONB), with kind `zotero_webdav`, `logion_webdav` or `url`, plus path, SHA-256 and size;
  - `reading_status`: `unread`, `skimmed`, `reading`, `close_read` or `archived`; and `read_at`.
- **Full text in `source_texts`.** Each row stores the text the browser extracted with pdf.js for one file version:
  - normalization `utf8-nfc-lf-v1`, the same as `SourceExcerpt`;
  - page offsets;
  - the extractor version.
- **Migrating `PaperRecord`.**
  - Each row becomes a `paper` resource, and the mapping is recorded.
  - `research_claims` gains `resource_id`, backfilled from the mapping; `paper_id` stays for one release.
  - `paper_records` becomes read-only while the research feature is enabled and is dropped in v0.3.1 after a rehearsal.
- **Excerpt origin.**
  - `source_excerpts` gains `origin` (`logion` or `zotero`) and `zotero_annotation_key`.
  - Excerpts imported from Zotero annotations are read-only in Logion.
- **Privacy.** Research data stays personal, as ADR-0011 requires, even inside a shared Space.

## Compatibility

- Additive DDL does not guarantee safe application rollback. An unpatched v0.2.x
  application is only a candidate on the new schema while there are no resources
  with non-null `research_owner_id` and no `resource_type` values unsupported by
  that application's validators. These preconditions require verification.
- Once personal resources exist, old v0.2.x endpoints do not filter
  `research_owner_id` and can expose private literature to other members of a
  shared Space. Old `resource_type` validation may also fail. This can happen even
  without enabling the research feature: legacy paper creation with the flag off
  creates a personal resource mapping in the same transaction.
- OpenAPI changes are additive only; this is checked by `check-openapi-breaking`.

## R1 owner-approved refinements (2026-09-27)

- **Private deduplication.** The owner approved Space + owner uniqueness because returning
  another member's existing ID would reveal private research inside a shared Space. A 409
  `LIBRARY_DUPLICATE` returns `details.existing_id` only for the caller's own record.
- **Feature-off writes.** The owner approved keeping legacy paper creation when
  `LOGION_RESEARCH_V3_ENABLED=false`; it creates the resource mapping in the same transaction.
  Enabling the feature blocks legacy paper creation with `RESEARCH_PAPERS_READ_ONLY`.
  This reconciles the read-only transition with the requirement to preserve disabled behavior.
- **Explicit ownership and mapping.** Nullable `research_owner_id` separates personal literature
  from existing shared materials. Nullable unique `legacy_paper_id` records the migration using
  new resource UUIDs, so pre-existing UUID collisions between the two tables cannot lose data.
  Claims reference the same owner, workspace and Space through a composite foreign key.
- **Legacy projections.** Personal resources are excluded from legacy sync, search, source
  selection, task evidence and export format. Research library APIs are online-only. A dedicated
  v0.3 export format is outside R1; existing paper exports remain available through their old model.

## Rollback

Turning off `LOGION_RESEARCH_V3_ENABLED` in the v0.3 application retains its
privacy filters; it is not equivalent to reverting the binary to unpatched v0.2.x.
Do not assume that old code ignores all new data safely.

Before R5, the owner must choose and record one of these policies:

- **A — rollback-safe v0.2.x patch (Claude's recommendation).** Publish and verify
  a v0.2.x patch before R5 that filters `research_owner_id` on legacy paths and
  preserves compatibility with the migrated resource types. Only that verified
  patch may be an application rollback target once personal resources exist.
- **B — forward fixes only.** After the v0.3 migration, prohibit rollback to v0.2.x
  and recover through forward application/schema fixes.

This R1-F change corrects documentation only. Policy selection is pending; it
does not implement option A or claim that any current v0.2.x release is safe.

Schema downgrade removes only unchanged derived paper copies. It refuses new or changed
personal resource data, which must be preserved before downgrade. Upgrade/downgrade tests
cover synthetic papers, deleted papers, UUID collisions and the refusal path.
