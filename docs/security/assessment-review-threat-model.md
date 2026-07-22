# Assessment and audit-review threat model

Status: L4-002A server foundation

## Assets and invariants

- Quiz answer keys are not disclosed by quiz creation or list responses. An authenticated
  learner receives the answer and explanation only after their attempt is durably recorded.
- QuizAttempt, ErrorPattern, AuditReview, and ReviewFinding are personal records even when
  their QuizItem and Topic are shared. Workspace roles never imply access to these records.
- Exact-match outcomes are derived by the server. Self-assessed outcomes require an explicit
  user value. AI cannot submit an attempt, complete a review, resolve a finding, or resolve an
  error pattern.
- An incorrect attempt may make the same user's ReviewSchedule due, but it cannot update a
  MasteryRecord or another user's schedule.
- Attempts are append-only. Review and finding state changes use optimistic versions and are
  security-audited without recording sensitive text or error details.

## Threat controls

| Threat                                      | Control                                                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Answer harvesting through list APIs         | QuizItem responses omit answer keys and explanations                                                                      |
| Cross-tenant or cross-Space item use        | Item and Topic are resolved against route Workspace and Space; scoped foreign keys enforce persistence boundaries         |
| Owner reads a member's score or weakness    | All attempt, pattern, review, and finding reads filter authenticated `user_id`                                            |
| Member creates a shared quiz                | Shared quiz creation requires `shared_plan.write`; read-only members can only attempt                                     |
| Client forges exact-match success           | Server normalizes and compares the submitted response; self-assessment is rejected for exact-match items                  |
| AI or implicit process changes formal state | Only CSRF-protected user routes record attempts, complete reviews, or resolve personal findings/patterns                  |
| Incorrect attempt changes mastery           | Feedback updates only ErrorPattern and ReviewSchedule with source `quiz_error`                                            |
| Identifier collision exposes another user   | Collisions return bounded conflict errors and never return the foreign record projection                                  |
| Sensitive content reaches audit logs        | Prompt, answer, response, confidence, error cause, summary, descriptions, and actions are excluded from audit metadata    |
| Storage or response exhaustion              | Strict text/numeric bounds, per-Space/per-user quotas, user rate limits, serialized quota locks, and bounded list queries |
| Duplicate period or stale completion        | Per-user period uniqueness plus expected-version state transitions                                                        |

## Residual and follow-up work

- L4-002B must add Vault-protected sync payloads, replay/ordering tests, and Review UI states
  before claiming offline assessment and audit review.
- A learner can intentionally submit a blank wrong attempt to reveal an answer. These quizzes
  are formative self-study tools, not proctored exams. High-stakes controls are out of scope.
- Mentor and group reporting requires a later explicit aggregate scope and minimum disclosure
  threshold; it must not reuse raw personal queries.
