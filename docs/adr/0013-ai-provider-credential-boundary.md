# ADR 0013: AI Provider credential and network boundary

Status: Accepted for Phase 5 L5-001

## Decision

- AI Provider configuration is Workspace-scoped and available only to Owner/Admin through
  the named `ai.configure` permission. Frontend visibility never grants authorization.
- L5-001 supports metadata for `openai_compatible` Providers only. Creating, updating or
  deleting a configuration does not make an outbound request and cannot affect core learning
  workflows.
- Provider credentials use per-record AES-256-GCM data keys wrapped by a versioned server
  keyring. AAD binds ciphertext to Workspace, Provider ID and key ID. API responses expose
  only `credential_configured`; browser storage, logs, audit metadata and export must never
  receive credential material.
- Base URLs require public HTTPS, no user information/query/fragment, a bounded port set and
  no loopback/private/reserved IP literal or local/internal hostname. Runtime DNS resolution,
  redirect revalidation and connection health belong to L5-002 and must re-check every hop.
- Provider deletion is a soft metadata tombstone that immediately clears all credential
  ciphertext and wrapped data-key fields. Reusing a deleted name is allowed.

## Compatibility and recovery

Migration 0023 is additive. Key rotation adds a new key ID, switches the active ID and
rewraps data keys before an old key can be retired. Backups must retain every key needed by
records or retained backup generations. After production credentials exist, rollback disables
AI routes/UI and uses a forward fix; it must not drop the Provider table or encryption keys.
