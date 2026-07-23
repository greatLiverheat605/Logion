# IndexedDB v4 attachment authorization handoff

Schema v4 retains every v3 store and index and adds the authorization metadata required to drain an
offline attachment through the server protocol: `space_id`, `target_type`, `target_id`, and the last
server version. New queue entries validate all UUIDs before the Blob is persisted.

Existing v3 attachment rows do not contain a target Space/object. The forward migration preserves the
Blob but changes the row to `failed` with `OFFLINE_ATTACHMENT_METADATA_REQUIRED`; it is not uploaded,
guessed, deleted, or silently attached elsewhere. Product UI may offer export/removal, but automatic
retry is prohibited until a user creates a new fully scoped queue entry.

The upload worker processes one pending entry as:

1. authenticated `init` with metadata, size and client SHA-256;
2. bounded binary `PUT` of the Blob;
3. `complete` using the upload response version;
4. retain `verified` and server version, or a stable redacted failure code.

Network exception details and response bodies are not stored in IndexedDB. A failed current-format
entry requires an explicit retry action. Schema downgrade remains prohibited; incompatible clients
must enter upgrade/re-bootstrap handling and must not replay attachment rows blindly.
