# Phase 6 release hardening and closeout

Date: 2026-07-23

Work package: `L6-008` / issue [#133](https://github.com/greatLiverheat605/Logion/issues/133)

Baselines: `LOGION_EXECUTION_PLAN.md` and `LOGION_AI_DEVELOPMENT_CONSTRAINTS.md`

## Decision

Phase 6 is an immutable release-candidate package for final human stage approval. The repository
implementation and automated release-hardening scope are complete for source commit
`a9b2f4ac2bc28e4dea89f041914e2d4376258f8d`. This document does **not** authorize Production,
claim that GitHub-hosted capacity is production-equivalent, or replace the manual and operational
release blockers listed below.

No known P0/P1 defect, tenant-isolation failure, data-loss path, silent conflict, credential leak,
or failed recovery remains in the retained automated evidence. Any later discovery of one of those
conditions invalidates this candidate.

## Final same-source evidence

| Gate              | Final run                                                                           | Result and retained evidence                                                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main candidate    | [30015803406](https://github.com/greatLiverheat605/Logion/actions/runs/30015803406) | Success; immutable Web/API/worker/backup images, SBOM, build provenance, dependency-license policy, digest scans, IaC/filesystem scans and candidate smoke                        |
| Full capacity     | [30015865113](https://github.com/greatLiverheat605/Logion/actions/runs/30015865113) | Success; artifact `8567111678`, profile `github-hosted-reference-full`, exact baseline counts and machine-readable percentiles; `production_equivalent_approved=false`            |
| Nightly assurance | [30015866638](https://github.com/greatLiverheat605/Logion/actions/runs/30015866638) | Success; frozen dependency audits, Compose smoke, migration, encrypted backup/empty restore, browser/PWA/WCAG automation and retained security/browser artifacts                  |
| Release candidate | [30016463574](https://github.com/greatLiverheat605/Logion/actions/runs/30016463574) | Success; artifact `8567480171`, version `0.1.0-rc.phase6-final`, unchanged Main images, same-source capacity verification, recovery, compatibility, browser and rollout rehearsal |

All four runs resolve to `a9b2f4ac2bc28e4dea89f041914e2d4376258f8d`. Superseded Main,
Capacity, RC and Nightly runs are not Phase 6 completion evidence.

## Immutable candidate identity

| Item           | Value                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| Repository     | `greatLiverheat605/Logion`                                                |
| Source         | `a9b2f4ac2bc28e4dea89f041914e2d4376258f8d`                                |
| Migration head | `0034_sync_conflicts`                                                     |
| Offline schema | `4`                                                                       |
| Sync protocol  | `sync-v1`                                                                 |
| Web            | `sha256:ae061baacc557a33dafdea0945336942cbaa856b31398799205b24fa8d9abb23` |
| API            | `sha256:0f67bfae8348accf94664e3ea536d9eece8d6bae540843169674723ac545b05f` |
| Worker         | `sha256:aa2dde57ef0e1e535adebd836c44141626eb5723b6f20ea2f5fa8dd75d6000fb` |
| Backup         | `sha256:68dd1a376ef391b73f6daa47e78ff698b04f599a95d90aea993327db59d11b8c` |

The candidate-security artifact reports all four attestations, all four image scans, the filesystem
scan and the IaC scan as passed. The production dependency license policy has no denied packages.
RC pulls these digest references and uses `up --no-build`; it does not rebuild the candidate.

## Phase 6 merged work

| Capability                                    | Pull requests                                                                                                                                                                                                                                                                                                                                                                      | Outcome                                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Immutable Main candidate and release identity | [#135](https://github.com/greatLiverheat605/Logion/pull/135), [#139](https://github.com/greatLiverheat605/Logion/pull/139)                                                                                                                                                                                                                                                         | Four digest-pinned images, manifest, SBOM/provenance, migrated smoke environment and bounded API p95 evidence                                                                         |
| Candidate supply-chain security               | [#136](https://github.com/greatLiverheat605/Logion/pull/136), [#141](https://github.com/greatLiverheat605/Logion/pull/141), [#142](https://github.com/greatLiverheat605/Logion/pull/142), [#143](https://github.com/greatLiverheat605/Logion/pull/143)                                                                                                                             | Patched Web dependency and base images, exact-digest attestation/image/filesystem/IaC gates and least-privilege backup runtime                                                        |
| RC validation, recovery and compatibility     | [#145](https://github.com/greatLiverheat605/Logion/pull/145), [#146](https://github.com/greatLiverheat605/Logion/pull/146), [#147](https://github.com/greatLiverheat605/Logion/pull/147), [#148](https://github.com/greatLiverheat605/Logion/pull/148), [#149](https://github.com/greatLiverheat605/Logion/pull/149), [#150](https://github.com/greatLiverheat605/Logion/pull/150) | Trusted-run preflight, safe artifact acquisition, migration-head verification, encrypted empty restore, sync-epoch replacement and machine-readable evidence                          |
| Staged rollout policy                         | [#152](https://github.com/greatLiverheat605/Logion/pull/152)                                                                                                                                                                                                                                                                                                                       | Ordered 5% → 25% → 100% rehearsal, candidate-bound evidence and fail-closed thresholds without changing Production traffic                                                            |
| Original 47-day template                      | [#155](https://github.com/greatLiverheat605/Logion/pull/155)                                                                                                                                                                                                                                                                                                                       | Versioned optional package with provenance/license metadata, preview-first private installation, new IDs, preserved relative dates, tasks, resource placeholders and acceptance gates |
| Verified attachment lifecycle                 | [#156](https://github.com/greatLiverheat605/Logion/pull/156), [#159](https://github.com/greatLiverheat605/Logion/pull/159)                                                                                                                                                                                                                                                         | `init → upload → complete → verified`, MIME/extension/size/SHA-256 checks, tenant/replay negatives, bounded offline queue and least-privilege shared volume                           |
| Full reference capacity gate                  | [#157](https://github.com/greatLiverheat605/Logion/pull/157)                                                                                                                                                                                                                                                                                                                       | Reproducible actual-schema dataset, hardware/generator metadata, query plans, saturation signals and p50/p95/p99 thresholds                                                           |
| Yjs note merge and durable conflict center    | [#161](https://github.com/greatLiverheat605/Logion/pull/161), [#162](https://github.com/greatLiverheat605/Logion/pull/162), [#163](https://github.com/greatLiverheat605/Logion/pull/163), [#164](https://github.com/greatLiverheat605/Logion/pull/164)                                                                                                                             | Additive Yjs stream/readable snapshots, encrypted Vault updates, real hash-only conflicts, atomic resolution Outbox/audit, real Sync Center and two-device/restart/security evidence  |

High-risk sync, attachment, migration, backup and release changes received independent review from
`diquizzer-ui` before merge. No implementation agent self-approved a protected change.

## Quality and capacity results

The final reference-capacity artifact created and measured the required actual-schema dataset:

- 100,000 tasks;
- 1,000,000 events;
- 25,000 notes plus 25,000 resources;
- 10,000 attachment rows and files;
- 5,000 papers;
- 100,000 AI runs.

Each of the six defined query scenarios used 30 measured samples after warm-up. All p95 values were
below the strict 500 ms threshold; the highest observed p95 was 4.510 ms for recent notes on the
recorded GitHub-hosted reference runner. This is regression/reference evidence only, not a claim
about approved Production hardware.

The RC browser report contains 54 expected passes, 6 declared skips, zero unexpected failures and
zero flaky tests across Chromium, Firefox, WebKit, mobile Chrome and mobile Safari emulation. The RC
offline compatibility report contains 24/24 passing tests across four suites. The encrypted recovery
rehearsal completed in 1,133 ms with an RPO sample of 2 seconds, matched migration head
`0034_sync_conflicts`, restored the expected tenant and attachment rows, verified the attachment
SHA-256, replaced the sync epoch and requires old clients to re-bootstrap while quarantining their
old Outbox.

## Section 9.2 release-scenario mapping

| Scenario                                                             | Retained evidence                                                                                                                                  | Status                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1. Two users and cross-Workspace denial                              | Phase 1–5 integration matrices plus final Fast/Integration/Nightly rerun                                                                           | Automated pass                                                                                     |
| 2. Viewer invitation and live revocation                             | Workspace invitation/membership integration and browser paths                                                                                      | Automated pass                                                                                     |
| 3. Generic plan through evidence, acceptance, review and daily audit | Phase 3 learning-loop and Phase 4 memory/audit integration                                                                                         | Automated pass                                                                                     |
| 4. Original 47-day import                                            | `test_original_47_day_template_import_is_bounded_private_and_date_preserving` and template UI/offline checks                                       | Automated pass                                                                                     |
| 5–6. Two-device offline note/status/object edits                     | Yjs two-device integration, encrypted restart test, critical status conflict test, durable resolution replay and attachment queue/API verification | Automated pass; physical phone remains manual                                                      |
| 7. Lost-device revocation                                            | Identity/device integration and residual-local-data warning behavior                                                                               | Automated pass                                                                                     |
| 8. Paper, question, experiment, metric and export                    | Research and portability integration                                                                                                               | Automated pass                                                                                     |
| 9. Provider fallback, confirmation and draft isolation               | AI Provider/routing/run/draft integration and threat models                                                                                        | Automated pass                                                                                     |
| 10. SSRF, malicious Markdown/attachment and tenant IDs               | Provider discovery, attachment, content, sync and tenant negative matrices                                                                         | Automated pass                                                                                     |
| 11. Backup, empty restore and old device                             | Final Nightly and RC `recovery-evidence.json`                                                                                                      | Automated pass                                                                                     |
| 12. Public/auth/application responsive and accessible paths          | Multi-browser automation, PWA/offline smoke, automated WCAG, keyboard and responsive viewports                                                     | Automated pass for automation; physical iOS/Safari and human screen reader remain release blockers |
| 13. Export then account deletion                                     | Portability and deletion integration, revocable shares and retention-state tests                                                                   | Automated pass; legal retention policy remains a human release decision                            |

## Integrated security review

The final review applied the `security-review` checklist to secrets, bounded input and uploads,
parameterized database access, authentication/authorization, XSS/CSP behavior, CSRF, rate limits,
error/log redaction and dependency controls.

- Workspace and Space authorization is server-resolved; cross-Workspace conflict and attachment IDs
  fail closed, and a different device cannot resolve the source device's conflict.
- Protected Note/Yjs/conflict payloads remain encrypted in the Vault. Entity, Outbox, conflict,
  audit and log rows do not contain the protected body.
- Conflict records store bounded hashes and metadata, never a second plaintext copy. Resolution is
  atomic with its Outbox operation and becomes resolved only after ACK; replay is idempotent.
- Attachments validate filename/path, allowlisted extension/MIME, detected content, size and SHA-256.
  Downloads are private/no-store, `nosniff` and attachment-disposition responses.
- State-changing browser requests retain authentication, CSRF and rate-limit boundaries. React
  conflict previews render bounded text and do not inject HTML.
- Final local and CI dependency audits found no known high/critical dependency vulnerability. Main
  candidate attestation, image, filesystem and IaC gates all passed, and the license deny list is
  empty.

## Compatibility and forward-fix boundary

Migration `0034_sync_conflicts` is additive and was verified through empty/latest upgrade and the PR
migration round trip. `note_document_update` is additive inside `sync-v1`; legacy clients continue to
receive readable Note snapshots. IndexedDB remains schema v4, keeps protected updates in the Vault
and preserves pending data across browser restart. A restore changes `sync_epoch`, requires old
clients to re-bootstrap and quarantines the pre-restore Outbox.

Do not roll an application binary back across a schema or sync semantic it cannot understand. Keep
the immutable failed candidate, stop promotion and use a new source commit plus forward fix. A new
source commit invalidates every run ID and artifact in this document and requires a new Main,
Capacity, Nightly and RC chain.

## Remaining human and operational release blockers

These items do not invalidate the completed repository automation, but they block public Production
and cannot be represented by synthetic CI evidence:

1. The human release owner must run critical flows on physical current Safari/iOS PWA and complete a
   human screen-reader/keyboard review. Owner: human release/accessibility owner. Deadline: before
   any Production approval.
2. The infrastructure owner must select cloud provider/region, configure immutable off-host backups
   in a separate account or failure domain, real alert routing, KMS/key escrow and an approved
   production-like capacity run. The current full run remains reference evidence with
   `production_equivalent_approved=false`. Deadline: before any Production approval.
3. Privacy/legal owners must approve terms, privacy notice, deletion/backup retention, shared-Space
   attribution and user-data residency. Deadline: before public registration or Production approval.
4. The human release owner must record Production monitoring links, on-call responsibility,
   observation windows and manual smoke results before using the 5% → 25% → 100% procedure. The
   retained rollout evidence is `mode=rehearsal`, uses synthetic policy samples and changes no
   traffic.

Issue [#153](https://github.com/greatLiverheat605/Logion/issues/153) therefore remains open for the
approved production-like capacity environment and other explicitly operational evidence. Production
deployment remains prohibited until these blockers are closed or the two root baselines are changed
through an explicit human decision.

## Human stage approval request

Human approval may close Phase 6 as a repository implementation/release-hardening stage and accept
the four items above as hard Production blockers. It must not be interpreted as a Production
deployment approval. Production requires its own later approval and the preflight → backup →
compatible migration → 5% → observe → 25% → 100% sequence.
