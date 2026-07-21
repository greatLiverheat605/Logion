# Sync v1 pull, bootstrap, and client loop

The server exposes authenticated, tenant-bound `pull` and `bootstrap` endpoints
under each Workspace. Pull pages are ordered by the Workspace sequence and use
an exclusive cursor. Epoch mismatch and expired retention cursors return
explicit control envelopes rather than ambiguous empty pages.

Bootstrap creates a deterministic snapshot identity from the Workspace, epoch,
head cursor, and RFC 8785 checksum. Chunks contain at most 100 records. Their
checksums and the framed snapshot checksum use the contract frozen in
`sync-v1-checksum-vectors.json`. A changed snapshot rejects resume and requires
the client to restart, preventing mixed-version activation.

The offline `SyncClient` pushes dependency-ordered Outbox operations, validates
every response with the runtime sync schema, applies acknowledgements and pull
pages in IndexedDB transactions, and advances the cursor only with a contiguous
page. Epoch, cursor-retention, and protocol controls update local bootstrap
state. A remote change never overwrites a pending local entity; it marks the
entity conflicted for the conflict-center workflow.

Current bootstrap records cover the first real synchronized entity adapter,
`Space`. Later entity adapters must add their snapshot projection and tests in
the same work package as their Push adapter.
