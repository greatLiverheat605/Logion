# Evidence and human-verification threat model

Status: L3-004B implementation baseline

## State and authority invariants

- Activity is not mastery. Ordinary task transitions still cannot enter `verified` or `done`.
- Evidence submission moves an `in_progress` task to `submitted` and creates exactly one pending
  verification record.
- Only the explicit authenticated verification endpoint can record `passed`, `failed` or
  `needs_revision`; there is no AI/service route to this use case.
- `passed` moves the task to `verified`. Failure or revision returns it to `in_progress`. Closing a
  task requires both `verified` state and a durable passed verification.
- Shared-Space submission requires `evidence.submit`; decisions and closing require `review.write`.
  Private Spaces remain owner-only.

## Threat controls

| Threat                          | Control                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cross-tenant evidence/reference | Workspace/Space scope checks plus composite foreign keys                                                                                                           |
| Forged note/resource evidence   | Referenced object must be live and in the same Workspace and Space                                                                                                 |
| Self-reported completion bypass | Evidence/verification state machine and task row locks                                                                                                             |
| Lost or repeated decision       | Expected versions, pending-only decision, unique verification per evidence                                                                                         |
| AI auto-approval                | No AI principal or adapter invokes decision; `decided_by` is the authenticated user                                                                                |
| CSRF or bulk abuse              | Trusted Origin, CSRF token, per-user/Workspace rate limit and Space quota                                                                                          |
| Sensitive review leakage        | Summary, URL and reviewer notes are omitted from audit metadata and logs                                                                                           |
| Malicious link                  | Strict HTTP(S) syntax; server stores but never dereferences it                                                                                                     |
| Offline plaintext disclosure    | Evidence and verification payloads use the encrypted browser Vault; IndexedDB entity, Outbox, bootstrap staging and conflict rows retain only encrypted references |
| Cross-device state drift        | Evidence creation emits a verification change; decisions and close actions emit task changes in the same database transaction                                      |
| Duplicate/crash replay          | Parent and deterministic derived operation identities are committed atomically and replayed idempotently                                                           |
| Forged offline projection       | Sync adapters validate Workspace/Space, referenced IDs, allowed fields, versions and causal predecessors before invoking domain services                           |
| Silent verification conflict    | Stale verification versions return an explicit status conflict whose remote payload is encrypted at rest by the client                                             |

## Client interaction invariant

The Today flow stores a local mutation before attempting the network. Evidence submission supports
text, HTTP(S) links and references to an existing Note or Resource in the same Space. Verification
offers explicit human buttons for `passed`, `failed` and `needs_revision`; only a passed record and a
`verified` task expose the separate close action. Pending, offline and conflict states remain visible.
