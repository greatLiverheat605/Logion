# Learning-science foundation threat model

Status: L4-001A implementation baseline

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

| Threat                                    | Control                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cross-tenant Topic or edge                | Workspace/Space resolution plus scoped Topic foreign keys                                                 |
| Cross-Space dependency                    | Both edge endpoints must be live Topics in the route Space; composite foreign keys enforce the same scope |
| Cyclic prerequisite graph                 | Strict self-link rejection, per-Space row lock and reachability check before insert                       |
| Concurrent duplicate edge                 | Per-Space serialization and a database unique edge constraint                                             |
| Viewer edits shared graph                 | Shared graph writes require `shared_plan.write`; Viewer retains read-only access                          |
| Member reads another member's mastery     | Mastery and schedule queries always filter by authenticated `user_id`                                     |
| Member changes another member's mastery   | Public confirmation derives `user_id` and `confirmed_by` from AuthContext, never payload                  |
| System suggestion overwrites confirmation | Suggestion updates only suggestion fields; confirmed level, actor and timestamp remain unchanged          |
| Suggestion targets an unauthorized user   | Internal suggestion use case verifies Private-Space ownership or active Shared-Workspace membership       |
| Stale or replayed confirmation            | Stable record IDs and expected version; mismatches return an explicit 409 conflict                        |
| Sensitive learning detail in logs         | Topic descriptions and suggestion reasons are excluded from audit metadata                                |
| Unbounded graph/storage abuse             | Strict Pydantic sizes, per-Space Topic quota, per-user rate limit and bounded traversal                   |

## Residual and follow-up work

- L4-001B must add protected offline/sync adapters for Topic, dependency, MasteryRecord and
  ReviewSchedule before the Review UI claims complete offline editing.
- L4-002 will derive suggestions from versioned quiz/review evidence and implement review lifecycle
  transitions. The internal suggestion use case is not exposed as a public HTTP endpoint.
- Aggregate mentor/group progress must use explicit reporting scope and minimum cohort disclosure;
  raw personal mastery remains unavailable to Workspace administrators by default.
