# ADR-0049: Research Question Hierarchy Without Data Loss

- Status: Accepted
- Date: 2026-09-29
- Scope: private research question editing, splitting and merging
- Related: ADR-0011 (personal research), ADR-0042 (knowledge network)

## Decision

Research questions gain `status` (`active`, `answered`, `parked`) and `parent_id`.
Existing records start active, with no parent. A composite foreign key requires the
parent to have the same owner, Workspace and Space; self-parenting is forbidden.

Splitting creates two to twenty children and retains the original question. Merging
creates a new common parent for two to twenty independent questions. It keeps the
original questions, rationale, statuses, descendants, experiment references and
citations. The interface explains this grouping before confirmation. It never
deletes sources or concatenates their prose. A question can be moved to another
parent or back to the root through editing.

Hierarchy writes reuse the existing membership lock, CSRF, trusted Origin and
write-rate boundary. Existing records require their expected version; grouping is
atomic and advances the versions of affected existing questions. Validation rejects
cycles, missing parents, ancestor/descendant selections in one merge and depths
above 32. Quotas count all live questions in the owner's Workspace, including new
parents and children. Tree validation loads IDs only, not question text.

The new feature-gated `research/question-tree` API keeps the legacy research API
unchanged. Listing is cursor-bounded; the interface identifies incomplete trees
until further pages are loaded. Semantic nested lists, native buttons and forms
support keyboard operation without a custom tree interaction mode.

Private ideas remain separate records and a separate view labelled “仅自己可见，AI
不可读”. No idea text is copied into questions or any AI context. Audit records hold
only action/result and actor, without private target IDs, Workspace IDs or text.

## Migration and verification

Migration `0053_question_tree` is additive and has one parent. Downgrade refuses
when any research question exists, even if all new fields still have default values.
Tests cover existing records, scope constraints, atomic grouping, stale concurrent
updates, cycles, quotas, denied requests and the disabled flag. Browser checks cover
the question and idea views, keyboard actions and four widths in both themes.
