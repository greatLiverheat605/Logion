# Audit query threat model

## Scope

L1-005A provides read-only, privacy-minimized query APIs for an authenticated user's own
identity audit events and for Workspace audit events visible to the Workspace Owner. Export,
retention management, search across Workspaces, raw metadata access, and administrative
impersonation are outside this slice.

## Assets and trust boundaries

- Audit rows may contain security-sensitive event relationships and internal correlation data.
- PostgreSQL is authoritative for event scope, ordering, and retention.
- The authenticated user and server-resolved Workspace membership are authoritative for access;
  client-provided role or Workspace context is never trusted.
- Pagination cursors cross the server-to-client trust boundary and are treated as untrusted input.
- Redis rate limits are a defensive control and do not grant access or alter query scope.

## Threats and controls

| Threat                                                       | Control                                                                                                                                                      | Verification                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Cross-account disclosure through the personal endpoint       | Constrain every query to the authenticated actor ID and the `identity.%` event namespace                                                                     | Integration test inserts multiple actors and non-identity events |
| Cross-Workspace disclosure or identifier probing             | Resolve active membership before querying; require `workspace.manage_security`; return the existing opaque `404` for outsiders                               | Owner, non-Owner member, and outsider integration cases          |
| Privilege escalation through a client-supplied role          | Derive permissions from the current database membership; only the Owner role has the required permission                                                     | Admin receives `403` even with a valid authenticated session     |
| Raw metadata or correlation identifiers expose secrets       | Return an explicit response allowlist and omit `event_metadata` and `request_id`                                                                             | OpenAPI and serialized-response assertions                       |
| Forged cursor changes tenant, account, or filters            | HMAC-sign a versioned cursor and bind it to its account/Workspace scope and a canonical filter fingerprint                                                   | Scope, filter reuse, and tampering tests                         |
| Pagination skips or duplicates rows with equal timestamps    | Use newest-first keyset pagination ordered by `(occurred_at, id)` with matching composite indexes                                                            | Equal-timestamp multi-page integration case                      |
| Unbounded queries exhaust database capacity                  | Enforce page size `1..100`, fetch at most one look-ahead row, validate filter lengths, and apply a dedicated account-wide rate limit before Workspace lookup | Schema validation and rate-limit configuration tests             |
| Ambiguous or hostile time filters alter results              | Require timezone-aware timestamps, normalize to UTC, and reject empty or reversed half-open ranges                                                           | Unit and integration filter tests                                |
| Browser or intermediary caches retain audit data             | Mark successful audit responses `Cache-Control: no-store`                                                                                                    | Header assertions on both endpoint families                      |
| State-changing request protections are accidentally weakened | Expose GET-only handlers with no mutation or transaction side effects except existing denied-access audit recording                                          | Route and integration review                                     |

## Residual risks and follow-up

- Audit retention, legal hold, redaction, export, and deletion policy require a later governance slice.
- Workspace Owners can see stable actor and target identifiers. A later presentation layer should
  resolve only identifiers that the viewer is independently authorized to view.
- Rate limiting reduces bulk collection but does not replace monitoring. Production operations should
  alert on repeated audit queries and authorization failures without logging cursor values.
- Signing-key rotation invalidates existing cursors by design. Clients must restart pagination after an
  `AUDIT_CURSOR_INVALID` response.
- Keyset pagination provides stable traversal of the chosen ordering but is not a database snapshot;
  events inserted during traversal can appear only after the client restarts from the first page.
