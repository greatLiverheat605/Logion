# Planning core threat model

L3-001A introduces user-authored goals, one plan per goal, immutable plan
versions, and ordered phase snapshots. The model is universal and stores no
hard-coded exam, subject, supervisor, or research-group context.

Every row carries a Workspace scope. Goals additionally carry a Space scope;
the composite foreign key forces their plan to stay in the same Workspace and
Space. Versions and phases use composite Workspace foreign keys, so a valid ID
from another tenant cannot be attached to a local aggregate. Client-generated
UUIDs are collision-checked across every planning table before insertion.

Private Space writes require the authenticated user to be that Space's owner.
Shared Space writes additionally require the canonical `shared_plan.write`
permission. The server derives both decisions from current membership and never
accepts role, owner, or authorization claims in the request body.

State-changing endpoints require Cookie authentication, trusted Origin,
double-submit CSRF, and a user/Workspace rate limit. Pydantic rejects unknown
fields, non-contiguous phase positions, duplicate IDs/criteria, excessive text,
and invalid time budgets. SQLAlchemy emits parameterized SQL. Audit records hold
IDs, phase counts, and version numbers only; descriptions, outcomes, and
acceptance criteria are excluded.

Creation writes the goal, plan, draft version, phases, and audit event in one
transaction. Publication locks the aggregate, validates optimistic versions,
and changes the draft to a published snapshot. Repeated or stale publication
fails with a stable conflict and cannot silently overwrite a newer plan.

`0010_planning_core` may be downgraded only before real planning data exists.
After use, rollback is application-level and schema repair is forward-only.
