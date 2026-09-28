# ADR-0052: Private Weekly Reading Plans and Statistics-Only Reviews

- Status: Accepted
- Date: 2026-09-29
- Scope: R3-5, implementing ADR-0044 under the owner's continuous delivery authorization
- Related: ADR-0038, ADR-0041, ADR-0044, ADR-0048

## Decision

Reuse Task and LearningGoal. Nullable research owner, resource, reading mode, scheduled date and completion timestamp distinguish private reading tasks from existing shared execution tasks. Composite foreign keys enforce the source's owner and Space; existing goal scope still applies. Old task contracts and sync payloads do not change. Legacy execution, content references, search, calendar, sync, export and Workbench references exclude all new reading tasks, including for their owner. A goal with private reading tasks cannot be cascade-deleted through the legacy endpoint. Account deletion removes private review/task rows before their resources and AI runs.

A weekly plan is the owner's reading tasks scheduled Monday through Sunday in one Space, bounded to 200 entries. Sources are optional, allowing a reading objective without a specific paper. Goals are explicitly selected, never silently created. The owner completes tasks; a linked close-reading task requires the source already be marked close-read. Completing a linked skim task records the owner's skim confirmation without reducing an existing close-read state. No AI score confirms task completion or mastery.

Weekly reviews are unique per owner, Space and Monday. Creation or explicit refresh stores a server-computed statistics and task/version snapshot, with a validated IANA time zone for activity boundaries. The time zone is fixed for that review. Statistics describe current records at snapshot time: planned/done tasks, sources completed in the week, quiz results, non-idea network changes, current open questions, outstanding reviews due by week end and reviews completed in the week. They are not an event-sourced historical reconstruction. Inbox count is zero until the inbox feature exists.

Every unfinished snapshot task requires carry, downgrade or drop; downgrade changes close read to skim. Optional reasons stay private. Space-scoped serialization and optimistic versions reject stale snapshots. Confirmation atomically creates next-week copies on matching weekdays and closes the review. Original tasks and snapshots are retained. Repeated confirmation returns the closed result without generating duplicates. Tasks in closed weeks cannot change; no task rolls over automatically.

Weekly AI comments use the existing research route, economical tier, budget, encrypted input and draft pipeline. Only one server-selected weekly review reference is accepted. Input is a fixed schema of nonnegative integer counters; there are no titles, reasons, source text, graphs, idea counts or arbitrary client strings. The worker rechecks the owner, membership, feature flag, snapshot version and canonical numeric input before egress. Generic AI routes cannot bypass this weekly task restriction. AI output remains a draft until the owner accepts it. Manual review confirmation works without AI.

## Compatibility and recovery

Migration 0055 adds nullable Task columns and weekly_reviews, preserving the single head. It performs no update or delete of existing data. Downgrade refuses if either the new table or any new Task column contains user data. The circular source/task reference is an explicitly named alterable FK. Feature-off preserves data. New endpoints and schemas are additive; old OpenAPI paths and schemas remain byte-semantically unchanged.

## Verification requirements

Prove same-Space peer and cross-Space denial, legacy projections and mutation rejection, foreign-key owner checks, stale/missing/duplicate triage rejection, concurrent/replayed confirmation, numeric-only provider payloads and idea sentinels, draft acceptance, default-off behavior, migration round trip and nonempty downgrade refusal. Keep real backend/browser validation and failure history with the stage evidence.
