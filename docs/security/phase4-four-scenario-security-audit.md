# Phase 4 four-scenario security audit

Status: candidate audit for L4-FINAL / issue #107

## Scope

This audit covers the Phase 4 learning-science foundation and the Exam, Self-study,
Research, and Collaboration scenario packages. It reviews REST, sync Push/Pull/Bootstrap,
offline Vault storage, Workspace/Space authorization, audit metadata, and dynamic user
context. It does not authorize a production release or replace the Phase 6 backup,
real-device, performance, or accessibility release gates.

## Authorization and disclosure matrix

| Boundary                                     | Exam                         | Self-study                   | Research                     | Collaboration                                 |
| -------------------------------------------- | ---------------------------- | ---------------------------- | ---------------------------- | --------------------------------------------- |
| Authenticated owner of a personal record     | Read/write own rows          | Read/write own rows          | Read/write own rows          | Role-based shared read/write                  |
| Workspace Owner/Admin reading another member | Denied even in Shared Space  | Denied even in Shared Space  | Denied even in Shared Space  | May read explicit Shared Space rows           |
| Reviewer                                     | No personal visibility grant | No personal visibility grant | No personal visibility grant | Shared read plus feedback append only         |
| Viewer                                       | No personal visibility grant | No personal visibility grant | No personal visibility grant | Shared read only                              |
| Other Workspace                              | Hidden                       | Hidden                       | Hidden                       | Hidden                                        |
| Another member's Private Space               | Hidden                       | Hidden                       | Hidden                       | Collaboration records cannot be created there |

The server resolves the authenticated membership and Space for every request. Personal
scenario queries also bind `user_id`; collaboration queries require `Space.visibility ==
"shared"`. Client-supplied role, Workspace ownership, and visibility are never accepted as
authorization conclusions.

## Attack review

| Threat                                                           | Control and evidence                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Guessed UUID returns another member's content in a sync conflict | Create adapters reject personal rows whose `user_id` differs before conflict projection; `test_phase4_security_integration.py` attacks Exam, LearningTrack, PaperRecord, and Rubric IDs and scans the response for victim text |
| Workspace owner aggregates private learning state                | Exam, Self-study, and Research REST plus Pull/Bootstrap tests assert owner/member separation; no scenario report service imports personal-domain tables                                                                        |
| Collaboration report silently scrapes private records            | ReportSnapshot accepts only an explicit bounded summary and same-Space ReviewRequest ID; the service imports no Exam, memory, self-study, research, note, or attachment model                                                  |
| Viewer or Reviewer mutates shared structure                      | Named permissions are enforced in CollaborationService; Viewer writes and Reviewer rubric/report writes fail; UI disables unsupported local mutations                                                                          |
| Private collaboration record enters sync                         | REST and sync creation require a Shared Space; Pull and Bootstrap independently join Space and require `shared` visibility                                                                                                     |
| Plaintext remains in IndexedDB entity/Outbox rows                | Protected repository routes all Phase 4 entity payloads through AES-256-GCM Vault references; the 32-case durable-row test checks every scenario package                                                                       |
| Sensitive payload enters audit/log metadata                      | Scenario audit events use empty/minimal metadata; integration tests scan for exam, objective, evidence, method, feedback, and report text                                                                                      |
| AI changes formal mastery, score, run, feedback, or report       | No Phase 4 service is registered as an AI write target; formal records require authenticated human REST/sync operations                                                                                                        |
| User-specific context ships as a product default                 | Production-path guard rejects named teacher/company context; no migration or seed creates an exam, course, supervisor, group, research direction, or schedule                                                                  |
| CSRF or untrusted Origin performs a write                        | All scenario REST writes and sync Push require trusted Origin and double-submit CSRF; missing-token integration cases fail                                                                                                     |
| Dependency or secret exposure                                    | Locked dependencies, secret scan in PR CI, `pnpm audit`, strict validation, and no new runtime dependency in Phase 4                                                                                                           |

## Migration and protocol compatibility

Migrations 0015 through 0022 are additive and retain UUID/Workspace/Space/version/audit
fields. Required Integration CI performs empty-database upgrade, Alembic schema drift check,
full downgrade/upgrade, and upgrade from a seeded earlier version. Sync entity types are
additive under `sync-v1`; protected offline payloads retain the existing encrypted reference
format and require no IndexedDB schema bump.

## Residual risks

- An authorized Shared Space member can retain content already synchronized before their
  membership is revoked. Server revocation stops future access but cannot erase an offline
  copy on an uncontrolled device.
- Physical Safari/iOS PWA storage eviction and background execution remain Phase 6
  real-device verification items; foreground encrypted editing and synchronization are the
  current authority.
- Phase 4 uses bounded lists and conservative record-level conflicts. Capacity/performance
  targets and CRDT/field-level merging remain later release gates; no silent overwrite is
  introduced.
- Reports are immutable application records but are not yet public, tokenized ShareSnapshot
  links; public sharing and revocation belong to Phase 5.
