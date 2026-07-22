# Learning-science foundation threat model

Status: L4-001B protected offline/sync baseline

## Authority and state invariants

- Topic titles, descriptions and dependency edges are user data. No subject, teacher, cohort or
  research-group context is embedded in the domain model.
- A Private Space remains owner-only. Shared-Space graph changes require `shared_plan.write`;
  read-only members cannot edit the shared topic graph.
- Mastery is personal even when its Topic is shared. A member can confirm only their own mastery,
  and topic listing joins only the authenticated user's MasteryRecord and ReviewSchedule.
- `suggested_level` and `confirmed_level` are separate fields. A system suggestion never changes,
  schedules or impersonates a user confirmation.
- A user confirmation is an explicit CSRF-protected action. It records the actor and time, advances
  an optimistic version, and creates or updates that user's review schedule.
- AI has no mastery mutation route. Later AI capabilities may produce drafts, not formal suggestions
  or confirmations.

## Threat controls

| Threat                                                 | Control                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant Topic or edge                             | Workspace/Space resolution plus scoped Topic foreign keys                                                                                     |
| Cross-Space dependency                                 | Both edge endpoints must be live Topics in the route Space; composite foreign keys enforce the same scope                                     |
| Cyclic prerequisite graph                              | Strict self-link rejection, per-Space row lock and reachability check before insert                                                           |
| Concurrent duplicate edge                              | Per-Space serialization and a database unique edge constraint                                                                                 |
| Viewer edits shared graph                              | Shared graph writes require `shared_plan.write`; Viewer retains read-only access                                                              |
| Member reads another member's mastery                  | Mastery and schedule queries always filter by authenticated `user_id`                                                                         |
| Member changes another member's mastery                | Public confirmation derives `user_id` and `confirmed_by` from AuthContext, never payload                                                      |
| Guessed foreign Mastery ID leaks a conflict projection | Sync rejects an ID owned by another user before conflict projection is constructed                                                            |
| System suggestion overwrites confirmation              | Suggestion updates only suggestion fields; confirmed level, actor and timestamp remain unchanged                                              |
| Suggestion targets an unauthorized user                | Internal suggestion use case verifies Private-Space ownership or active Shared-Workspace membership                                           |
| Stale or replayed confirmation                         | Stable record IDs and expected version; mismatches return an explicit 409 conflict                                                            |
| Sensitive learning detail in logs                      | Topic descriptions and suggestion reasons are excluded from audit metadata                                                                    |
| IndexedDB exposes learning content                     | Topic, dependency, Mastery and ReviewSchedule payloads use the offline Vault; entities, Outbox and conflicts retain only encrypted references |
| Pull/bootstrap exposes personal state                  | Topic graph follows Space visibility; Mastery and ReviewSchedule add an authenticated `user_id` filter                                        |
| Partial network failure changes schedule identity      | The pending encrypted Mastery payload retains and reuses its stable schedule ID until Pull succeeds                                           |
| Consecutive offline confirmations reorder              | A later local confirmation depends on the preceding Mastery operation; server derives the causal version after its predecessor                |
| Derived schedule is lost or observed late              | Confirmation appends the schedule change and Mastery change in one transaction; the operation result points at the final sequence             |
| Unbounded graph/storage abuse                          | Strict Pydantic sizes, per-Space Topic quota, per-user rate limit and bounded traversal                                                       |

## Residual and follow-up work

- L4-002 will derive suggestions from versioned quiz/review evidence and implement review lifecycle
  transitions. The internal suggestion use case is not exposed as a public HTTP endpoint.
- Aggregate mentor/group progress must use explicit reporting scope and minimum cohort disclosure;
  raw personal mastery remains unavailable to Workspace administrators by default.
