# ADR-0025: Yjs note document stream and readable snapshots

- Status: Accepted
- Date: 2026-07-23
- Decision owner: Logion sync/content contract owner
- Tracking: [#160](https://github.com/greatLiverheat605/Logion/issues/160)

## Context

`sync-v1` currently treats a note edit as a whole-record update. Concurrent offline edits therefore
produce a record conflict even when two devices changed independent parts of the Markdown document.
The product baseline requires Markdown/Yjs updates to merge as an idempotent document stream while
critical status, hierarchy, permission, delete/update and acceptance conflicts remain explicit.

The existing note payload can contain 500 KB of Markdown. Adding a base64 CRDT state to that same
record would exceed the offline per-record integrity limit. Changing the existing sync envelope or
the meaning of `note.update` would also break strict older clients.

## Decision

Keep the `sync-v1` envelope and existing `note` snapshot compatible. Add two bounded, additive entity
types:

- `note_document_state` appears in bootstrap and contains the note ID, Space ID, note version and a
  base64 Yjs-compatible state update. It is a protected record and must be encrypted before IndexedDB
  persistence.
- `note_document_update` appears in Push/Pull and contains one base64 Yjs-compatible update. The
  server applies it to the locked note document without whole-record version rejection, persists the
  merged state, regenerates readable Markdown, advances the note version and appends the operation to
  the existing idempotency/change ledger.

The Yjs root type is a single `Y.Text` named `markdown`. Update bytes are canonical base64, non-empty
and bounded by the existing sync operation limit. The merged readable snapshot remains bounded by
the note Markdown limit. Authorization resolves the Workspace, Space and note on the server; clients
cannot select a foreign document by supplying an embedded identifier.

Ordinary REST/whole-record note updates remain supported and reset the Yjs state from the accepted
Markdown snapshot while advancing a monotonic document generation. An incremental update is accepted
only for its bootstrap generation, preventing an old update from merging into an unrelated rebuilt
document. This preserves compatibility for older clients without allowing last-write-wins: their
stale whole-record updates still conflict. Legacy clients may ignore unknown additive entity types
and continue reading the refreshed `note` snapshots.

## Security and privacy invariants

- CRDT state and updates are note content, not metadata. They are Vault-encrypted in offline storage,
  excluded from audit metadata and never rendered as HTML.
- Payload hashes and operation IDs retain existing replay protection. Same operation/same hash is
  idempotent; the same operation with changed bytes fails closed.
- Malformed, empty, oversized or non-canonical base64 and merged Markdown over 500 KB are rejected.
- Cross-Workspace, cross-Space, deleted-note and revoked-device attempts use the existing opaque
  authorization boundary.
- Status and structural conflicts do not enter the Yjs path.

## Compatibility and rollback

Migration `0033_note_yjs_state` backfills every current note from its readable Markdown and is
forward-only after Yjs writes begin. An older compatible binary can read Markdown snapshots but must
not be promoted as a writer because it cannot preserve the Yjs state. Rollback therefore means stop
writes and deploy a forward fix, not drop the state column after document updates exist.

Real-time presence, cursors and institution-scale simultaneous editing are out of scope. The first
release guarantees asynchronous/offline merge, deterministic replay and readable snapshots.
