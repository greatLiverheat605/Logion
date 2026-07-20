# Workspace ownership transfer threat model

## Scope

L1-003D covers direct atomic transfer from the current Owner to an active member and self-service
leave for non-Owners. Two-party acceptance, billing transfer, notifications, and Workspace deletion
are separate work.

## Invariants

- An API transaction never commits zero or multiple Owner roles.
- Only the live active Owner with `workspace.manage_security` may initiate transfer.
- The target must be a different active non-Owner membership in the same Workspace.
- Workspace, source membership, and target membership versions must all match.
- The former Owner receives an explicit non-Owner role in the same transaction.
- Owner cannot self-leave; transfer must complete first.

## Threats and controls

| Threat                                                | Control                                                                                                               | Verification                                                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Two concurrent transfers create multiple Owners       | Lock Workspace, re-resolve the live actor with `populate_existing`, then lock both membership rows in stable ID order | Concurrent requests yield exactly one success and database owner count remains one |
| Revoked or downgraded Owner completes a stale request | Refresh identity-map entities on every Workspace resolution after acquiring the Workspace lock                        | Losing concurrent request receives 403 after the winner demotes the actor          |
| Stale UI transfers to the wrong membership state      | Require exact Workspace, current Owner, and target membership versions                                                | Independent conflict tests for all three versions                                  |
| Admin or outsider transfers ownership                 | Require Owner-only `workspace.manage_security`; cross-tenant targets are scoped by Workspace                          | Admin/outsider denial and opaque 404 tests                                         |
| Suspended, revoked, or existing Owner becomes target  | Target validation requires active and non-Owner under row lock                                                        | Invalid-target integration tests                                                   |
| Last Owner leaves                                     | Self-leave rejects role `owner` after locking and re-reading membership                                               | Owner leave before and after transfer returns `OWNERSHIP_TRANSFER_REQUIRED`        |
| Member continues access after leaving                 | Leave changes membership to revoked atomically; all Workspace access resolves active membership live                  | Existing session receives 404 on the next request; replayed leave receives 404     |
| Audit exposes personal data                           | Audit contains Workspace/membership IDs and role/status deltas only                                                   | Audit metadata assertion excludes email                                            |

## Residual risks and follow-up

- Direct transfer does not require acceptance by the target. A future enterprise policy may add a
  pending, expiring, two-party transfer without weakening the atomic commit invariant.
- Billing ownership and external provider credentials are not yet implemented and must define their
  own transfer coupling before launch.
- Database repair for a pre-existing corrupt Owner count remains an operator-only audited procedure.
