# Auth / Callback / Onboarding Conformance Baseline

## Scope

- Formal routes: `/auth/login`, `/auth/register`, `/auth/verify`, `/auth/recover`, `/auth/callback`, `/onboarding`.
- Visual source: frozen GLM PublicShell targets and `specs/02-05`.
- Behavior source: formal Session/API/CSRF/MFA/Passkey/token-fragment/onboarding contracts.
- Evidence viewport set: `320x640`, `390x844`, `1024x768`, `1440x900`.

## Before Evidence

| Route | Before files | Structural finding |
| --- | --- | --- |
| Login | `before/auth-login-*` | A decorative visual consumes the primary viewport and pushes credentials below the fold instead of using the 440px focused PublicShell. |
| Register | `before/auth-register-*` | The old split layout remains; policy, form and recovery are not distinct GLM regions. |
| Verify | `before/auth-verify-*` | Credential setup still inherits the oversized split-auth composition and has no explicit token-state/recovery regions. |
| Recover | `before/auth-recover-*` | Request/completion states are vertically stacked in the old shell and the persistent exit path is missing. |
| Callback | `before/auth-callback-*` | Callback uses the generic `session-state` layout instead of PublicShell and exposes no explicit recovery region. |
| Onboarding | `before/onboarding-*` | A sidebar card plus a second content card repeats the old page-within-page pattern; persistent context and focused recovery regions are absent. |

## Frozen Before / Target Difference

| Route | Formal primary task | GLM layout tree | Required change |
| --- | --- | --- | --- |
| Login | Establish a device session | PublicShell -> Identity -> Credentials -> Recovery | Remove decorative split visual; keep password, device naming, MFA and Passkey in one focused flow. |
| Register | Start registration under deployment policy | PublicShell -> Policy -> Form -> Recovery | Present invite policy as a compact state, retain privacy-preserving response and closed-mode error. |
| Verify | Confirm fragment token and set credentials | PublicShell -> Token state -> Credentials -> Recovery | Keep token in the fragment and clear it before any request; add explicit invalid-link and login recovery. |
| Recover | Request or complete recovery | PublicShell -> Recovery form -> Privacy feedback -> Exit | Preserve equal account-disclosure feedback, optional TOTP/recovery-code completion and global session revocation wording. |
| Callback | Resolve authenticated destination | PublicShell -> Transient status -> Recovery | Preserve settings lookup and onboarding redirect; add retry and login recovery without inventing a Passkey route. |
| Onboarding | Configure first-use context | PublicShell -> Stepper -> Current step -> Persistent context | Preserve the seven formal API-backed steps while replacing the sidebar/card stack with a single focused workspace. |

## Function Reachability Freeze

| Flow | Required reachable behavior | Baseline disposition |
| --- | --- | --- |
| Login | Password session, detected/editable device name, protected Cookie session, settings retry | Preserve |
| MFA | TOTP and recovery-code choice, challenge token, cancel back to login | Preserve |
| Passkey | Capability check, WebAuthn challenge/verify, device name, error recovery inside `/auth/login` | Preserve; no `/auth/passkey` route |
| Register | Invite-only wording, privacy-equal success, `AUTH_REGISTRATION_CLOSED`, request ID | Preserve |
| Verify | URL fragment token consumption/clearing, 12-character password, confirmation match, no automatic session | Preserve |
| Recover | Privacy-equal request, fragment completion, optional TOTP/recovery code, session revocation, request ID | Preserve |
| Callback | Complete/incomplete onboarding redirect, settings failure retry, login recovery | Preserve |
| Onboarding | Persona -> Workspace -> Space -> local Vault passphrase -> optional Template -> first Goal -> complete | Preserve order and real service side effects |
| Accessibility | Password manager, paste, autocomplete, visible password toggle, keyboard order, focus restoration, reduced motion | Required enhancement |

## Frozen Deviations

- GLM prototype fixtures, hash routing, prototype badges and mock registration modes are presentation references only and must not enter the formal application.
- The prototype-only `/auth/passkey` route remains excluded; Passkey is a secondary login method.
- The formal seven-step onboarding contract overrides prototype step data and sequencing.
- Mobile interactive targets are raised to at least `44x44px` even where the GLM prototype uses 40px controls.

## Step 1 Result

The formal behavior surface is fully mapped and no API payload, permission rule or security boundary needs to change. Implementation may now replace the PublicShell, field composition, stepper and feedback presentation while retaining all entries above.
