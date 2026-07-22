# Shared collaboration review threat model

Status: L4-G1 protected offline/sync baseline

| Threat                                         | Control                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Viewer or Reviewer changes shared structure    | Named server permissions; Reviewer can append feedback only; Viewer has no write permission                  |
| Workspace role reads a private Space           | Collaboration service rejects every non-shared Space before read or write                                    |
| Cross-Workspace or cross-Space parent ID       | Scoped parent lookup plus composite foreign keys and IDOR integration tests                                  |
| Chosen UUID reveals another tenant's record    | Out-of-scope collisions return the same not-found boundary without payload disclosure                        |
| Report silently changes after publication      | ReportSnapshot exposes create/read only; sync update/delete operations are rejected                          |
| Report leaks private learning or research data | Report service accepts only explicit summary input and imports no personal-domain service or table           |
| Review payload leaks through logs or audit     | Empty audit metadata; tests scan audit metadata for rubric, submission, feedback, and report text            |
| Offline durable rows expose shared content     | All four entity types use the encrypted Vault; durable entity and Outbox projections omit plaintext payloads |
| Offline client bypasses role checks            | Sync create dispatch calls the same CollaborationService authorization used by REST                          |
| Child operation arrives before its parent      | Rubric→Review and Review→Feedback/Report dependencies are explicit and parent lookups fail closed            |
| AI publishes formal feedback or reports        | No AI route, worker, or draft-acceptance path targets collaboration records                                  |

Residual risk: any authorized Shared Space member can retain content already synchronized to
their device. Revocation prevents future server access and sync but cannot erase an offline
copy from a device outside platform control; product disclosure must state this limitation.
