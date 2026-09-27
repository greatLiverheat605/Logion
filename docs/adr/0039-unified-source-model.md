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
  - identifiers `doi`, `arxiv_id` and `pmid`, each unique per Space when present, used for deduplication;
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
  - `paper_records` becomes read-only and is dropped in v0.3.1 after a rehearsal.
- **Excerpt origin.**
  - `source_excerpts` gains `origin` (`logion` or `zotero`) and `zotero_annotation_key`.
  - Excerpts imported from Zotero annotations are read-only in Logion.
- **Privacy.** Research data stays personal, as ADR-0011 requires, even inside a shared Space.

## Compatibility

- Every change is additive, so the v0.2 application still runs on the new schema.
- OpenAPI changes are additive only; this is checked by `check-openapi-breaking`.

## Rollback

Revert the application. The new columns and tables are ignored by v0.2.
