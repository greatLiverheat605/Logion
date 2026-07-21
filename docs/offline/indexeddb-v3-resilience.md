# IndexedDB v3 resilience, local vault, and residual data

Schema v3 adds durable `conflicts`, `attachmentQueue`, `vaultMetadata`, and
`vaultRecords` stores without rewriting v1 entity/Outbox data or v2 bootstrap
staging. Upgrade interruption remains governed by IndexedDB's version-change
transaction.

Conflicts preserve local and remote payloads until the user explicitly keeps
local, keeps remote, merges, or dismisses. Resolution and the entity sync state
change in one transaction. Dismissal intentionally leaves the entity marked as
conflicted; it is not a silent winner.

Attachments remain local Blobs until upload support is enabled. The queue
rejects path separators, MIME/extension mismatches, empty files, unsupported
types, and files above 20 MB, then records a SHA-256 checksum. Server upload and
verification are a later adapter; only `verified` attachments may become formal
evidence.

Protected future note/research payloads use `OfflineVault`: PBKDF2-SHA-256
(310,000 iterations) derives a non-exportable AES-256-GCM key from the local
passphrase. Each record has a random 96-bit IV and Workspace/record AAD. The key
exists only in memory and is discarded on lock. Phase 2 synchronized Space
records contain only name/visibility metadata; sensitive Phase 3 entities must
store their bodies in `vaultRecords`, never plaintext `entities.payload`.

Logout and device revocation cannot remotely erase an offline browser with
certainty. The UI therefore makes residual-data risk explicit. Revoked devices
remain locally locked. On shared devices, `wipeLocalData()` clears vault keys,
encrypted records, entities, Outbox, conflicts, and attachment Blobs in one
IndexedDB transaction. Users must choose this destructive local action.

Rollback is forward-only: older clients detect schema version 3 as an upgrade
requirement and must not open or downgrade the database. Recovery uses the
server bootstrap after installing a compatible client.
