# ADR-0055: Unified online review with legacy memory semantics

- Status: Accepted
- Scope: R4 unified review
- Related: ADR-0003, ADR-0031, ADR-0033, ADR-0036, ADR-0043, ADR-0054
- Authority: the owner-approved remaining-development specification requires old knowledge points, recall items and private reading quizzes in the new review page.

## Decision

The new `/review` page combines ordinary topics and recall items with the existing private reading review. Bounded `/research/memory` projections and writes sit behind the default-off research switch. Topic, quiz, attempt, dependency and source-link collections are paginated. Ordinary adapters reject private research rows; private quizzes continue to use the R2 reader and owner-only services.

Reuse `MemoryService` for topic/recall correction, exact-match normalization, self-assessment, error patterns, prerequisite validation and mastery scheduling. Editing ordinary shared content requires `SHARED_PLAN_WRITE`; readers may submit only their own attempts and confirm only their own mastery. An answer does not confirm mastery. Answer keys and explanations are absent from unattempted quiz projections. Existing attempts lock the judging mode. Editing an answer does not rescore stored attempts.

Writes lock Workspace and sync state before Space and domain rows, reauthorize after waiting, and append the existing sync serializers in the same transaction as business data and audit. Ledger failure rolls back all changes. Existing sync cursors receive ordinary changes; no private reading rows enter that ledger. Origin, CSRF, rate limiting, shared permissions and legacy wire contracts stay unchanged.

Retiring a recall item uses the existing ADR-0031/0036 deletion scope: soft-delete the item and its navigation links, keep attempts, error patterns, mastery and schedules. Topic references still block deletion. The UI requires an impact preview and an explicit confirmation under “更多”. Personal schedule status is not repurposed as item retirement. This adapter adds no physical deletion or cleanup policy.

Existing note source links are authorized against both the target and the note in the current Space. A question without its own source may use its topic's source. Missing, changed, deleted and unavailable sources are distinguished. The server verifies the stored excerpt hash and returns current UTF-16 selection offsets; `/records?note=…&source=…` opens the exact note and selects that range. Source text stays in its existing note; it is not copied to an AI context. Questions without a recorded source say so explicitly. Private reading quizzes return to their existing PDF and quiz locator.

Forms preserve input on failures and require explicit resubmission. Unsubmitted answers consult the workbench navigation guard. Changes use online requests and in-memory state; no IndexedDB writes, Service Worker, new dependency or migration.

## Verification and recovery

Integration coverage includes legacy cursors, exact and self-assessed grading, personal mastery, stale updates, retained history after retirement, deletion blockers, shared/private isolation, CSRF/Origin/default-off, revoked membership after lock waiting, shifted UTF-16 source positions and atomic rollback. Real backend browser coverage includes phone answering, source navigation, offline retention, keyboard interaction and four widths in both themes. Disable the research switch to return to legacy clients; ordinary content and history remain compatible.
