# Workspace invitation threat model

## Scope

L1-003B covers authenticated creation, acceptance, and revocation of Workspace invitations.
Email delivery, signed-out acceptance, member mutation, and Owner transfer are outside this slice.

## Assets and trust boundaries

- The invitation token is a bearer secret shown once to an authorized inviter.
- The normalized invited email is personal data stored only for account binding and delivery work.
- Workspace role and membership status remain server-authoritative on every request.
- Redis rate limits are defensive controls; PostgreSQL rows are authoritative for token state.

## Threats and controls

| Threat                                              | Control                                                                                                                         | Verification                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Database disclosure exposes usable invitation links | Generate at least 256 bits of entropy and store only a domain-separated HMAC-SHA256 token hash                                  | Integration test compares returned token with stored digest         |
| Token leaks through URL, proxy, or analytics logs   | Accept token only in JSON request body; mark the one-time creation response `Cache-Control: no-store`                           | OpenAPI test rejects any token path parameter                       |
| Token probing reveals invited email or Workspace    | Missing, mismatched, expired, revoked, and replayed tokens return the same `INVITATION_INVALID` response                        | Wrong-account, expiry, revocation, and replay tests                 |
| Two requests accept the same token                  | Lock the invitation row; change status and create membership in one transaction                                                 | Concurrent acceptance yields exactly one success and one membership |
| Stale role or forged client role escalates access   | Persist the server-issued role; disallow Owner in schema and database checks; only `workspace.manage_members` can create/revoke | Role contract and Viewer denial tests                               |
| Cross-tenant revocation or ID probing               | Resolve active membership and named permission before selecting an invitation scoped by both IDs                                | Existing opaque Workspace authorization plus focused revoke tests   |
| Invitation spam or brute force                      | Separate hashed Workspace/account creation limits and IP/account acceptance limits                                              | Unit configuration checks and remote Redis integration              |
| Audit or logs disclose token/email                  | Audit only invitation ID, Workspace ID, actor, role, result, and coarse denial reason                                           | Integration assertions inspect audit metadata                       |

## Residual risks and follow-up

- Until an email worker is delivered, the authorized inviter must transfer the one-time token through
  a trusted channel. The product must not imply that email was sent.
- Public registration still lacks production email verification; invitation acceptance therefore binds
  to the authenticated normalized email but does not prove mailbox control. Email verification remains
  a production launch blocker.
- Role mutation, removal, last-Owner rules, and session invalidation remain L1-003C work.
