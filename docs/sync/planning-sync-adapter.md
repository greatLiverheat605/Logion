# Learning goal sync adapter

`learning_goal/create` carries a complete initial aggregate: target Space,
client-generated plan/version/phase IDs, goal fields, and ordered phases. The
server validates it with the same strict planning DTO and calls the canonical
PlanningService, so offline creation cannot bypass private/shared Space
authorization, quotas, audit, or database scope constraints.

The goal aggregate, processed operation, change record, and audit commit in one
transaction. Replays return the original sequence/version. Bootstrap projects
the same aggregate shape. Pull and bootstrap expose a goal only when its Space
is shared or owned by the current user; invisible change sequences are skipped
while the cursor still advances.

Publication remains an explicit online operation in L3-001B. Offline publish,
plan restructuring, and concurrent phase editing require version-aware update
adapters and are not represented as create operations.
