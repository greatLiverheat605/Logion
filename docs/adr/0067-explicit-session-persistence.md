# ADR-0067: Explicit browser session persistence

- Status: Accepted; implementation detail of ADR-0038
- Date: 2026-10-04
- Scope: complete the existing online-client plan; production deployment remains paused
- Basis: the owner requested completion and validation of the existing approved plans on 2026-10-04.

## Decision

The login page shows an unchecked “保持登录” checkbox. Password and Passkey login
send the explicit choice. Without it, access, refresh, CSRF and device cookies
have no `Max-Age` or `Expires`. Selecting it retains their existing persistent
lifetimes. Browser session restoration may retain session cookies; shared-device
users must explicitly sign out, and the UI does not promise reliable detection
of a closed browser.

The server stores the choice on `auth_sessions`. Password login with MFA stores
it on the challenge first, then transfers it to the verified session; the second
factor request cannot override it. Refresh reads the stored choice and never
turns a nonpersistent session into a persistent one. Session expiration, recent
authentication, token rotation and replay protection, CSRF, Origin, Secure,
HttpOnly and SameSite rules remain unchanged.

The two existing request schemas gain an optional strict boolean
`keep_signed_in`. Omission preserves legacy client behavior (`true`), while the
new UI always sends its explicit value. Additive non-null database columns
default to `true`, preserving existing sessions and challenges.

## Rollback and validation

Schema downgrade refuses to remove this choice while an unrevoked, unexpired
nonpersistent session or an unused, unexpired nonpersistent MFA challenge exists.
Use a forward fix or a compatible application rollback that preserves the choice.
A rollback candidate bound to the previous schema cannot be reused as evidence
for this migration; its schema binding and compatibility checks must be renewed.

Integration checks cover both cookie modes and refresh for password, TOTP,
recovery-code and cryptographically verified Passkey login, plus omission by a
legacy client. Migration checks cover backfill, round trip and refusal to lose
an active privacy choice. The login UI verifies the unchecked default and both
explicit submissions.
