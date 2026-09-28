# ADR-0053: Online planning and review projection

- Status: Accepted
- Scope: R4 today and planning pages
- Related: ADR-0003, ADR-0032, ADR-0043, ADR-0044, ADR-0052
- Authority: the owner-approved remaining-development specification authorizes additive online pages and preservation of legacy behavior.

## Decision

New `/research/goals` routes reuse the existing goal creation, publication and in-place phase revision services. Separate response schemas include phase archive status and a removal capability. They do not modify old OpenAPI paths or schemas. Goal fields use creation validation, absent fields stay unchanged, and only an explicit null target date clears a value. Basic and phase revisions share `LOGION_PLANNING_PHASE_REVISION_ENABLED`. The research routes also require `LOGION_RESEARCH_V3_ENABLED`; both flags retain their production defaults.

Online writes to these legacy entities append the existing sync ledger in the business transaction. They use server-generated operation IDs and existing payload serialization. Lock order is Workspace, sync state, then business rows; authorization is checked before locking and again after waiting. Shared goals retain `SHARED_PLAN_WRITE`, private Spaces retain owner isolation, and every request retains Origin, CSRF and rate controls. No new sync entity or client Outbox is introduced. A ledger failure rolls back business changes and audit records together. The goal revision remains optimistic and stale requests fail without changes.

The online phase response exposes whether removal is permitted, including references from soft-deleted tasks. It does not expose another person's private task identifiers, text or counts. The service remains authoritative when a new reference appears after the page loaded. Phase removal is explicit and protected as in ADR-0032; archive and restore remain reversible.

The today page uses the browser's local calendar date. Its cutoff is the start of the following local day, transmitted with an explicit timezone offset. The review projection returns the current user's active schedules ordered by due timestamp and ID, with bounded keyset pagination. It includes legacy knowledge and the user's private research topics only; private topics require the user's explicit mastery confirmation. Deleted topics and inactive schedules are excluded. The projection does not change scheduling, grade an answer or confirm mastery. Reading and legacy assessment actions retain their existing service boundaries.

## Recovery

Disable research UI entry points to return to the existing pages. No migration or destructive downgrade is introduced. Goal changes remain visible to existing clients through their normal sync cursor. Neither online page stores business data in IndexedDB or starts a Service Worker.
