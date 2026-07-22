# Personal exam countdown threat model

Status: L4-E1/L4-E2/L4-E3 protected offline/sync baseline

## Assets and invariants

- Exam title, date, time zone, and target score are personal data.
- A shared Space does not make an Exam shared. Reads always filter authenticated `user_id`.
- Scheduled dates are timezone-aware and paired with a valid IANA identifier; undetermined
  dates have no instant.
- Target score and scale are validated as one bounded pair.
- The countdown is derived for display and does not mutate business state.

## Threat controls

| Threat                                      | Control                                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Workspace owner reads a member's target     | REST, Pull, and Bootstrap filter Exam by authenticated `user_id`                                                   |
| Hidden changes stall another device         | Pull filters the record but advances the global cursor                                                             |
| Cross-tenant or cross-Space identifier use  | Workspace and Space resolution precedes writes; scoped foreign keys enforce persistence boundaries                 |
| Identifier collision exposes a foreign Exam | Collision returns a bounded error or sync rejection without a foreign projection                                   |
| Forged or ambiguous date                    | Strict schema, aware-datetime check, IANA allow-list validation, and database shape constraint                     |
| Invalid score pair                          | Strict numeric bounds and database constraint require a complete pair with target at or below scale                |
| CSRF write from another site                | Trusted-origin and double-submit CSRF checks protect REST and Sync Push                                            |
| Request or storage exhaustion               | Per-user quotas, write/sync rate limits, payload limits, and bounded lists                                         |
| Audit-log disclosure                        | Audit metadata records only the non-sensitive date-status enum; title, instant, time zone, and scores are excluded |
| IndexedDB disclosure                        | Exam payloads use the Vault; durable entity, Outbox, and conflict rows store encrypted references only             |
| Duplicate offline creation                  | Operation replay is idempotent and returns the original sequence/version                                           |
| AI changes a formal target                  | No AI write path exists; formal mutations require an authenticated user action                                     |
| Clock drift changes stored truth            | Countdown is a pure projection and never writes back to Exam state                                                 |
| Cross-owner Subject or parent link          | Composite foreign keys and owner-scoped resolution bind the hierarchy to one user and Space                        |
| Subject weights exceed the whole            | A locked Exam row serializes bounded basis-point totals; the database bounds each weight                           |
| Cyclic or forged syllabus hierarchy         | A new node selects only an existing same-Subject parent; schema and database reject self-parenting                 |
| Client forges coverage                      | Create payload coverage is discarded and the server initializes `not_started`; AI has no transition path           |
| Owner reads a member's mock score           | REST, Pull, and Bootstrap filter MockExam and ScoreRecord by authenticated `user_id`                               |
| Forged score or completion time             | Numeric bounds, score-at-most-scale, aware datetime validation, and database constraints reject it                 |
| Score history is silently rewritten         | ScoreRecord is append-only; later correction requires an explicit supersession contract                            |

## Residual and follow-up work

- A compromised unlocked browser session can read decrypted personal data. Session expiry,
  device revocation, Vault locking, and browser hardening reduce but cannot eliminate this.
- Browser clocks may be inaccurate; the UI should eventually expose clock provenance or
  server-time drift without making the server clock an offline dependency.
- Mentor or group visibility requires explicit consent, revocation, minimum disclosure, and
  separate aggregate authorization before implementation.
