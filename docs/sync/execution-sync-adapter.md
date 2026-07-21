# Task and study-session sync adapter

Status: L3-002B implementation baseline

## Supported operations

| Entity          | Operation | Server behavior                                                           |
| --------------- | --------- | ------------------------------------------------------------------------- |
| `task`          | `create`  | Validates the complete create DTO and creates a backlog/planned task      |
| `task`          | `update`  | Applies only an allowed state-machine transition with an expected version |
| `study_session` | `create`  | Starts a session only after the related task is `in_progress`             |
| `study_session` | `update`  | Completes or abandons the active session without completing its task      |

Every applied operation writes the domain record, processed-operation identity, change ledger and
privacy-minimized audit event in one transaction. Replays return the original sequence and server
version. Unsupported, malformed and unauthorized operations fail closed.

## Offline causal chains

An offline user may create a task and transition it before receiving a server version, or start and
finish a session in the same way. Such an update has `base_version = 0` and must depend on a prior
processed operation for the same Workspace, device, entity type and entity ID. The server resolves
the current version only through that explicit causal predecessor. A zero-base update without the
predecessor is rejected.

Starting a session never performs an unledgered task transition. Offline clients first enqueue the
task transition to `in_progress`, then make the session creation depend on it.

## Conflict and visibility behavior

- Stale task/session updates return an explicit `status` conflict containing the authorized remote
  version and resolution choices. They are not appended as applied changes.
- The browser stores protected conflict payloads in `vaultRecords`; the conflict row contains only
  `encrypted_payload_ref`.
- Pull and Bootstrap project tasks and sessions only through visible Shared Spaces or Private Spaces
  owned by the current user.
- Pull cursors may advance across invisible private changes. Clients accept strictly increasing
  visible sequence numbers without requiring them to be contiguous.

## Protected local data

Task payloads and study-session payloads are encrypted before entering IndexedDB. Entity and Outbox
rows contain only an encrypted reference and hash. Payloads are decrypted transiently for sync
transport and React rendering. Task descriptions, session reflections and remote conflict bodies
must not appear in entity, Outbox, conflict, telemetry or audit metadata.

## Compatibility and recovery

Migration `0012_session_sync_fields` backfills `updated_by` from `created_by`, adds `deleted_at`, and
then enforces the update-actor foreign key. The sync-v1 framing is unchanged; the already-defined
conflict result is now emitted by the API. Epoch mismatch still isolates the Outbox and requires a
new atomic Bootstrap before new pushes are accepted.
