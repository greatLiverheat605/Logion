# Phase 5 integrated audit and closeout

Date: 2026-07-23  
Work package: `L5-099` / issue [#131](https://github.com/greatLiverheat605/Logion/issues/131)  
Baseline: `LOGION_EXECUTION_PLAN.md` and `LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`

## Decision

Phase 5 is a release candidate for human stage approval after the closeout pull request and its
latest `main` build are green. It does not authorize production deployment. AI remains optional,
all AI output remains a draft until an explicit user decision, and core learning, offline and data
portability paths do not depend on an AI Provider.

## Merged evidence

| Capability                                                        | Pull request                                                 | Immutable main commit                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| Encrypted OpenAI-compatible Provider configuration                | [#112](https://github.com/greatLiverheat605/Logion/pull/112) | `16f582f0072ec86d4cd06e2e7bdcee4f8890ca60` |
| DNS-pinned model discovery and health                             | [#114](https://github.com/greatLiverheat605/Logion/pull/114) | `c66604eb512b41c46c489da1520d6dcd7a68954e` |
| Routing, pinned models and budget reservation                     | [#116](https://github.com/greatLiverheat605/Logion/pull/116) | `fbe1cd3b96e9b02f0e0015d39ee36205bf0f12a3` |
| Durable AI runs, cancellation and human-approved drafts           | [#118](https://github.com/greatLiverheat605/Logion/pull/118) | `0d6b63c14e72e29acd0a2a7f8527b25595ed750b` |
| Versioned templates and revocable read-only shares                | [#120](https://github.com/greatLiverheat605/Logion/pull/120) | `a1dbac6d0eb4bd8ba88266b47aa2ea2a7cb047dd` |
| Permission-aware search, minimal notifications and calendar feeds | [#122](https://github.com/greatLiverheat605/Logion/pull/122) | `4898f21ecd57d9eee65863b6c0d76acc76659bae` |
| Encrypted, versioned, requester-scoped exports                    | [#125](https://github.com/greatLiverheat605/Logion/pull/125) | `c3c32784c01f4d0a97c21a2a3a05a37bb61f132b` |
| Bounded preview-first imports into owned private Spaces           | [#126](https://github.com/greatLiverheat605/Logion/pull/126) | `8b5f3a20bdca96ef8d247d98d790186e69e6cda4` |
| Recoverable account deletion lifecycle                            | [#128](https://github.com/greatLiverheat605/Logion/pull/128) | `fb7cafea654d9a463ce16fed3a7b97c933a4e270` |
| Encrypted backup and empty-environment restore rehearsal          | [#130](https://github.com/greatLiverheat605/Logion/pull/130) | `1491d1201e5d117c7c6f8369073e854b24257c3d` |

The backup candidate passed [Nightly run 29942294757](https://github.com/greatLiverheat605/Logion/actions/runs/29942294757), including migration to head, encrypted bundle verification, restore into an empty database, attachment marker recovery and mandatory `sync_epoch` replacement.

## Baseline mapping

| Baseline requirement                            | Evidence and boundary                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replaceable AI and user-configured endpoint     | Provider records are Workspace-scoped; credentials use envelope encryption and are never returned to the browser. The first adapter is OpenAI-compatible HTTPS only.                                                                                                                                                                      |
| SSRF and malicious Provider response control    | URL canonicalization rejects credentials, query, fragment, non-HTTPS and literal private addresses. DNS must resolve exclusively to public addresses; the selected address is pinned, redirects are disabled, proxy environment is ignored and response bytes/schema are bounded.                                                         |
| AI failure must not block core learning         | AI work is queued separately. Provider errors become stable run failures/fallback attempts; no planning, execution, content, review, sync or portability endpoint calls an AI Provider.                                                                                                                                                   |
| AI only creates drafts                          | Provider output is schema-checked and persisted as `AIOutputDraft`; formal records change only through an explicit draft decision with target-version conflict checks.                                                                                                                                                                    |
| Templates and shares do not become ACL bypasses | Templates contain an immutable structured allowlist and install with new IDs. Shares contain only explicitly selected fields, store only a purpose-scoped Token HMAC and are checked for status/expiry on every public read.                                                                                                              |
| Search permission before content                | Server search first resolves visible shared Spaces and the requester's private Spaces. The POST body and audit metadata never persist the query. Offline search uses only the encrypted, unlocked local cache.                                                                                                                            |
| Minimal notifications and revocable calendar    | Notification rows contain bounded summaries, security notifications cannot be disabled, and target access is rechecked. Calendar Token is returned once, stored as HMAC and projects only titles and dates—not notes, attachments, answers or descriptions.                                                                               |
| User-controlled export and safe import          | Export artifacts are AES-GCM encrypted at rest, integrity checked on download and bound to requester/workspace. Import accepts four bounded data formats, performs no fetch or code execution, shows warnings/counts before commit and creates new IDs only in an owned private Space.                                                    |
| Recoverable deletion                            | Recent authentication, CSRF, exact confirmation and rate limits gate deletion. Access and bearer links are revoked immediately; a restricted recovery login can only inspect/cancel during the 14-day default grace period. Due cleanup removes direct personal data and credentials and pseudonymizes retained audit/shared attribution. |
| Backup and empty-environment restore            | PostgreSQL custom dump, attachments and a version manifest are authenticated with AES-256-GCM. Restore rejects unsafe archive members and non-empty targets, verifies the dump and forces every Workspace to receive a new sync epoch.                                                                                                    |
| Dynamic user context                            | Production paths contain no real teacher, lab, school, company, exam, research direction or personal schedule. Personas are composable capabilities and all content is created, imported or installed by the user.                                                                                                                        |

## Integrated security review

The closeout review applied the repository `security-review` checklist across authentication,
authorization, secrets, input bounds, injection, CSRF, rate limiting, error/log redaction and
dependency controls. React changes from Phase 5 retain the established performance boundary:
offline search code is dynamically loaded after unlock and is not added to the online first-load
bundle.

Four defects found by the integrated review are fixed in the closeout candidate:

1. Export descendants without a direct `space_id` (`PlanVersion` and `PlanPhase`) now follow the
   parent plan's Space authorization, preventing another member's private plan data from entering
   an export.
2. Share listing and revocation now require access to the source Space, preventing Editors from
   seeing metadata for or revoking another user's private-Space share.
3. Account deletion locks pending invitations for sole-owned Workspaces, rechecks active members
   and revokes every still-pending invitation issued by the deleting user, closing the invite versus
   deletion race.
4. The convenience `tasks.csv` derivative neutralizes spreadsheet formula prefixes. The authorized
   canonical values remain available in `data.json`.

No Provider credential, backup key, export/import key, session, recovery material, share Token,
calendar Token or retained AI input is included in ordinary responses, audit metadata or exports.
No SQL is assembled from user input; identifiers and sorting remain parameterized or allowlisted.

## Verification matrix

| Gate                         | Required result                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Python unit/security tests   | Export/import crypto and parsing, backup envelope/archive and new CSV protection pass.                                                  |
| PostgreSQL/Redis integration | Cross-Space export, private-share management and deletion-invitation negative tests pass with all existing Phase 1–5 integration tests. |
| Contracts and migrations     | OpenAPI generation is clean; migration head is `0031_account_deletion`; empty database upgrade passes.                                  |
| Web/offline                  | Recursive TypeScript tests, strict typecheck, formatting and production build pass; dynamic-context guard passes.                       |
| Supply chain                 | Secret scan, dependency audit and locked dependency installation pass in CI.                                                            |
| Recovery                     | Nightly encrypted backup → verify → empty-database restore → attachment check → new sync epoch passes.                                  |

The final closeout PR and latest `main` check URLs are recorded in the pull request and Phase 5 issue
before closure; failed or superseded runs are not completion evidence.

## Data compatibility and rollback

The closeout fixes do not add a migration or change OpenAPI, IndexedDB or sync protocol schemas.
They only narrow server-side reads to already-authorized Spaces, revoke pending invitations during an
existing deletion transaction and escape a convenience CSV projection. Application rollback to the
pre-closeout commit is mechanically possible but reopens confirmed security defects and is therefore
not approved. Use a forward fix if an operational regression appears.

## Residual risks and Phase 6 input contract

The following are explicit Phase 6 release blockers or human policy decisions, not claims of Phase 5
completion:

1. Configure encrypted immutable off-site backup copies in a separate account/region, cloud KMS or
   equivalent key escrow, retention lock and alerting. The Compose backup volume is only a server-side
   recovery copy.
2. Keep attachment-volume promotion and every production restore behind human approval; rehearse a
   production-equivalent restore with measured RPO/RTO.
3. Move large encrypted export artifacts from PostgreSQL to private object storage without weakening
   lifecycle, integrity, requester authorization or cache controls.
4. The first import intentionally supports note, resource, paper and inbox-item records. Unsupported
   records remain explicit preview warnings; this is not a full Workspace backup restore.
5. Privacy/legal owners must approve deletion grace duration, backup expiry disclosure and retention
   rules for contributions to shared Spaces before public release.
6. Phase 6 must complete capacity, browser/PWA, WCAG 2.2 AA, security scanning, observability, alerting,
   staging migration, release-candidate artifact and human production-approval evidence from the two
   baselines. No production release is authorized by this document.
