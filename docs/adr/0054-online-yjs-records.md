# ADR-0054: Online Yjs records and legacy sync compatibility

- Status: Accepted
- Scope: R4 records page
- Related: ADR-0003, ADR-0038, ADR-0041, ADR-0053
- Authority: the owner-approved remaining-development specification requires existing notes to remain readable and editable online.

## Decision

Add bounded `/research/notes` summary and detail routes under the existing default-off research switch. List queries select metadata only. Ordinary notes retain Space authorization and shared `SHARED_PLAN_WRITE`; private close-reading notes are visible only to their owner. Reading note edits retain the existing reader service. An unavailable source is reported explicitly while retained note text stays readable. Private research rows never enter the legacy note writer or sync ledger.

Ordinary note creation uses `ContentService.create_note`. Body updates use incremental Yjs updates with the existing generation and base-version rules. Concurrent edits in one generation merge. Title updates use optimistic version checks and preserve the document, task association and generation. New title validation matches the existing 200-character database limit without changing the old OpenAPI schemas.

The adapter locks Workspace and sync state before Space and note rows, and reauthorizes after waiting. Business writes, audit, readable note snapshots, document state and incremental update ledger entries commit together. The existing sync serializers and entity types are reused, so clients with an existing cursor receive online changes without wire changes. Ledger failure rolls back all writes. Origin, CSRF, rate limits and default-off gating remain required.

The editor holds Yjs state in memory, sends incremental updates after an idle editing interval and acknowledges only the revision actually sent. Edits made while saving remain dirty. Title changes flush pending body updates first. Failures retain input and offer explicit retry or a confirmed reload; ordinary save receipts stay inline. Navigation and context controls consult the unsaved-input guard. No IndexedDB writes, Service Worker, dependencies or migration are added.

## Verification and recovery

Integration checks cover old-note editing, two-client merge, existing sync cursors, generation/stale-title conflicts, ledger rollback, revoked access after a lock wait, shared roles and private source isolation. Browser checks exercise real services, in-flight edits, offline retention, keyboard controls and four widths in both themes. Disable the research entry point to use old clients; the same notes and sync history remain available.
