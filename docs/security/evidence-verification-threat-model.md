# Evidence and human-verification threat model

Status: L3-004A implementation baseline

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

| Threat                          | Control                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Cross-tenant evidence/reference | Workspace/Space scope checks plus composite foreign keys                            |
| Forged note/resource evidence   | Referenced object must be live and in the same Workspace and Space                  |
| Self-reported completion bypass | Evidence/verification state machine and task row locks                              |
| Lost or repeated decision       | Expected versions, pending-only decision, unique verification per evidence          |
| AI auto-approval                | No AI principal or adapter invokes decision; `decided_by` is the authenticated user |
| CSRF or bulk abuse              | Trusted Origin, CSRF token, per-user/Workspace rate limit and Space quota           |
| Sensitive review leakage        | Summary, URL and reviewer notes are omitted from audit metadata and logs            |
| Malicious link                  | Strict HTTP(S) syntax; server stores but never dereferences it                      |

## Follow-up

L3-004B must protect evidence and reviewer-note payloads in the offline vault, expose conflicts
without plaintext-at-rest, and keep decisions as explicit user actions in the Records/Today flow.
