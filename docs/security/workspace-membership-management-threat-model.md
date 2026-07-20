# Workspace membership management threat model

## Scope

L1-003C covers manager-only membership listing and mutation for non-Owner memberships. Ownership
transfer, self-leave, invitation delivery, notifications, and UI are separate work packages.

## Authorization rules

- Owner may manage any non-Owner membership and assign `admin` or a lower role.
- Admin may manage only `editor`, `contributor`, `reviewer`, and `viewer`, and may assign only those
  roles.
- No actor may mutate their own membership through this API.
- Owner membership is immutable here; it requires the future ownership-transfer transaction.
- Restoring a revoked membership requires Owner authority.
- Every write re-resolves the actor after acquiring the Workspace lock and locks the target membership.

## Threats and controls

| Threat                                                                      | Control                                                                                                            | Verification                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Admin promotes self or a peer to take over                                  | Central hierarchy rejects self-change, Owner targets, peer Admin targets, and Admin assignment by Admin            | Pure role matrix and PostgreSQL integration tests        |
| Revoked manager completes a write after stale authorization                 | Resolve once to hide cross-tenant IDs, lock Workspace, then re-resolve live actor membership before locking target | Integration and independent concurrency review           |
| Two managers silently overwrite a role                                      | Require exact `expected_version`, lock the target row, and increment version atomically                            | Stale-version test returns `MEMBERSHIP_VERSION_CONFLICT` |
| Existing browser session keeps Workspace access after suspension/revocation | Workspace resolution reads active membership on every request; roles are not cached in auth sessions               | Same-session 404 immediately after state change          |
| Cross-tenant membership ID probing                                          | Scope actor and target to the requested Workspace; outsiders receive the same opaque 404 boundary                  | Cross-tenant list/update tests                           |
| Audit or member list leaks unnecessary identity data                        | Member email is visible only to `workspace.manage_members`; audit stores IDs and role/status deltas, never email   | Viewer list denial and audit metadata assertion          |
| Revoked member is reactivated by Admin                                      | Only Owner may transition `revoked → active`; lower-role changes cannot bypass this condition                      | Restoration hierarchy tests                              |

## Residual risks and follow-up

- Owner transfer and last-Owner protection are intentionally absent and must not be simulated through
  this endpoint.
- Notifications for role changes and revocation are not yet delivered.
- Large Workspace pagination and retention/redaction of historical revoked identities require a later
  privacy and scale decision.
