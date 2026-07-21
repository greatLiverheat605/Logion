# Protected Phase 3 offline payloads

Phase 3 goal descriptions, outcomes, phase criteria, notes, resources, and
evidence can reveal private study or research context. They must not be stored
as plaintext in IndexedDB entity, Outbox, bootstrap-staging, or pull records.

`ProtectedOfflineRepository` seals the full payload in `vaultRecords` before an
atomic entity/Outbox commit. Those operational records contain only an opaque
`encrypted_payload_ref`; their payload Hash remains the RFC 8785 Hash of the
clear payload. A repeated operation is validated before any vault overwrite,
so a changed-payload replay cannot destroy the original encrypted data.

`SyncClient` requires an unlocked vault to hydrate a protected Outbox operation
immediately before transport. It never writes the clear value back to the
entity or Outbox. Protected pull changes are sealed before the entity/cursor
transaction. Replaying a page after a crash is safe and only replaces encrypted
ciphertext for the same entity reference.

`BootstrapRepository` verifies record/chunk/snapshot Hashes against the received
clear response, then seals protected records before staging them. If the vault
is absent or locked, bootstrap fails closed. The server remains the encrypted
transport boundary's trusted endpoint; TLS and authenticated tenant/Space
authorization are still required.

Vault ciphertext uses AES-256-GCM with Workspace/record AAD and a non-exportable
in-memory key derived by PBKDF2-SHA-256. Closing the authenticated planning
component drops its database and vault references. Offline actions remain
pending when the network fails and resume only after the user unlocks again.
