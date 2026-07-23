# ADR 0026: Durable and encrypted sync conflict resolution

- Status: Accepted
- Date: 2026-07-23
- Decision owners: Logion sync and offline contract owners
- Related: Issue #160, ADR 0025

## Context

The original offline conflict repository preserved two values but resolved them by directly
mutating an IndexedDB entity. It did not create an Outbox operation, the server did not consume
the existing `conflict_resolution` envelope, protected payloads were not guaranteed to remain in
the Vault, and a forged or stale conflict ID could not be checked because conflicts were not
durable on the server. The sync page also displayed fixed demonstration counts.

Logion must preserve unsent work, require an explicit choice for unsafe conflicts, support offline
resolution, and make the resulting server write and audit trail replay-safe without storing an
extra plaintext copy of private notes or research content.

## Decision

1. The server persists a hash-only `sync_conflict_records` row when a version conflict is returned.
   It stores Workspace, source operation/device, entity identity, versions, payload hashes,
   allowed resolutions, status, and timestamps. It does not store either conflict payload.
2. Conflict IDs include the remote version and payload hash and are inserted with PostgreSQL
   `ON CONFLICT DO NOTHING`. Concurrent replay therefore returns the same conflict without a
   uniqueness failure.
3. A server-recorded resolution must match the Workspace, source device, entity, open status,
   allowed option, expected remote version, current entity version, and selected payload hash.
   Cross-Workspace, forged, stale, changed-payload, dismissed-as-write, and replay-mismatched
   requests fail closed.
4. `keep_local` and `merge` use the normal domain update path and its permission and validation
   checks. `keep_remote` appends a new sync ledger event for the already-current server snapshot.
   Successful resolutions close the conflict and create a `sync.conflict.resolved` audit event
   containing IDs, resolution, and versions only.
5. The browser stores protected local, remote, merged, and selected payloads only as encrypted
   Vault records. Entity, Outbox, and conflict rows contain references and hashes. Selecting a
   resolution atomically seals the payload, replaces the conflicting Outbox entry, updates the
   entity, and marks the conflict `resolving`; only an ACK marks it resolved.
6. Pull-only conflicts receive deterministic local IDs. They are not presented to the server as
   server-recorded conflicts. Accepting the pulled remote snapshot is local convergence; keeping
   or merging local content creates an ordinary version-checked update.
7. “Copy as new object” creates a new Note or Resource with a new ID, then resolves the original
   object by adopting the server version. This preserves both intentions without overwriting the
   original identity.
8. The conflict center uses the authenticated Workspace/device and real IndexedDB/Vault,
   displays bounded field differences as React text, and reads the actual conflict and attachment
   queues. It identifies provenance as “current device” and “server version”; it does not reveal
   another member's device name or identifier.

## Consequences

- Migration `0034_sync_conflicts` is required and becomes the release migration head.
- Conflict resolution is auditable and replay-safe, while protected content is not duplicated in
  the server conflict table or plaintext browser rows.
- A resolution can remain `resolving` while offline or blocked. Both versions remain recoverable
  until server acknowledgement.
- Pull-only convergence does not create a server conflict audit event when the user simply accepts
  an unchanged server snapshot; no server mutation occurred.
- Real-time collaborative editing remains out of scope. Yjs Markdown merging follows ADR 0025;
  status, hierarchy, permission, deletion, and verification conflicts remain explicit choices.

## Rejected alternatives

- Last-write-wins: silently loses evidence and critical state.
- Client-only conflict IDs sent as authoritative server records: permits forgery and stale writes.
- Persisting full conflict payloads on the server: duplicates private content and enlarges the
  breach surface.
- Direct IndexedDB mutation without Outbox and ACK: cannot synchronize or audit the decision.
- Exposing remote device metadata to improve labels: unnecessary for resolution and unsafe across
  shared Workspaces.
