# ADR-0050: Private Typed Links and AI Suggestion Boundaries

- Status: Accepted
- Date: 2026-09-29
- Scope: implementation of ADR-0042, behind the existing research flag
- Related: ADR-0041 (AI context), ADR-0042 (relations), ADR-0019 (account erasure)

## Decision

Every knowledge edge belongs to one user, Workspace and Space, including edges
between otherwise shared endpoints. A peer or administrator cannot read or decide
another user's edges. Each request rechecks Space access and live endpoint ownership.
Audits record actor, action and result, without private IDs, reasons or source text.

Typed nullable endpoint columns reference resources, questions, topics, claims or
ideas with composite foreign keys. Generated `from_type`/`from_id` and
`to_type`/`to_id` expose the ADR-0042 shape without an unenforced polymorphic ID.
Database constraints enforce exactly one endpoint per side, the fixed directed
relation vocabulary, no self-links, and same scope. Private question, claim and idea
foreign keys include the owner. Resources and topics may be shared legacy records;
the service checks their nullable personal owner on every read and write. Evidence
is a live authorized excerpt in the same scope. Topic prerequisites stay in the
existing `TopicDependency` table.

Manual creation produces a confirmed edge. AI can only create suggested edges,
with run provenance and a bounded reason. Its input comes through the existing
research route, context allowlist, encrypted input, task routing, budget accounting
and outbound privacy gate. The literature-links skill returns source labels from
the supplied context. Labels map to immutable server-selected IDs and versions;
the provider cannot supply arbitrary IDs or an idea endpoint. Access and versions
are rechecked before egress and before saving the result. Invalid or stale output
cannot partially persist edges, but measured provider usage is still charged.

Suggestions and the AI draft are saved atomically. Each owner/pair/relation has a
single identity across all statuses. Existing edges, including rejected ones, are
excluded from later suggestions and their persisted draft output. Rejected records
are retained, count against the bounded per-user quota and cannot be resurrected by
AI. Only authenticated owner requests protected by Origin, CSRF, write limits,
membership locking and expected versions can confirm or reject. Confirmed edges
may be rejected later; rejected edges remain terminal. Idea links are manual only,
and neither their text nor their adjacency is ever loaded for AI context.

GET lists are cursor-bounded and read-only. Soft-deleted or inaccessible endpoints
and evidence hide their edges without deleting rejection records. The existing
explicit account-erasure flow removes the owner's edges before excerpt and AI-run
cleanup; a reference to evidence cannot accidentally erase a rejection tombstone.

## Migration and rollback

`0054_knowledge_edges` adds the table, its indexes and the idea scope uniqueness
constraint. There is one migration head. Empty upgrade/downgrade/upgrade is supported;
any edge, including a rejection, blocks downgrade. Disable the research flag and
retain the schema when user data exists. No changes enter sync-v1 or offline storage.
