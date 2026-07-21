# Sync v1 push and Space create adapter

`POST /api/v1/workspaces/{workspace_id}/sync/push` accepts the authoritative
`sync-v1` push envelope. The path, envelope, every operation, authenticated
device, and authorized Workspace must identify the same context.

## Security and limits

- Cookie authentication, trusted Origin, and double-submit CSRF are mandatory.
- Requests are rate limited per Workspace and user. Limits are configured with
  `LOGION_SYNC_PUSH_LIMIT_PER_MINUTE`, `LOGION_SYNC_MAX_OPERATION_BYTES`, and
  `LOGION_SYNC_MAX_BATCH_BYTES`.
- Pydantic rejects unknown fields and validates the schema bounds before use.
- The server recomputes payload hashes and operation fingerprints. It never
  trusts a client-supplied authorization result or fingerprint.
- A mismatched epoch returns an explicit `rebootstrap_required` control message.

## Transaction behavior

Operations retain input order. Each operation runs in a database savepoint, so
an unsupported or unauthorized operation is rejected without rolling back
successful siblings. Dependencies on a failed operation receive
`blocked_dependency`. A successful Space mutation, audit event, processed
operation, and change-log record commit in one outer transaction.

The initial adapter supports only `space/create` with `base_version=0`, a
client-generated entity UUID, and an exact payload of `name` and `visibility`.
All other valid operation shapes are rejected with stable `SYNC_*` codes and do
not mutate business data.

## Recovery

The migration and endpoint are forward-fixed. To disable push without losing
the durable ledger, remove the route from the API deployment while retaining
the three sync ledger tables. Clients keep their Outbox entries and retry after
service recovery.
