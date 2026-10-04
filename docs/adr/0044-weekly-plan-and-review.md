# ADR-0044: Weekly Plan and Review

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.3 planning page
- Related: ADR-0032 (goal phase lifecycle)
- Approval: in the 2026-09-27 kickoff the owner accepted the recommended weekly review. Under it, unfinished items are triaged one by one and never roll over automatically.
- Absorbs: v0.2.4 item E2 (editing a goal's basic fields), which was not shipped separately.
- Accepted: the owner reviewed and accepted this record on 2026-09-27 (PR #269).

## Decision

- **Weekly plan.** Built on existing goals and tasks. A task may reference a source (`tasks.resource_id`), so a plan item can be "close-read this paper" or "skim these".
- **Weekly review.** Stored in a new `weekly_reviews` table, one row per user, Space and week (keyed by the Monday date). It holds:
  - `stats`: a server-computed snapshot of:
    - planned versus done;
    - sources close-read and skimmed;
    - quiz results;
    - knowledge-network changes;
    - open questions;
    - reviews due and completed;
    - agent inbox items, from v0.3.1;
  - `triage`: for every unfinished item, carry over, downgrade (close read to skim) or drop, with an optional reason;
  - an optional AI comment draft, economical tier, whose input is the statistics only (ADR-0041);
  - `closed_at`: when set, the next week's plan is generated from the carried-over items.
- **Goal fields (E2).**
  - The goal update also applies title, desired outcome, description, weekly minutes and target date, with the same validation as at creation.
  - An absent field keeps its value. Phases follow ADR-0032 unchanged.
  - The existing `LOGION_PLANNING_PHASE_REVISION_ENABLED` flag gates both.

## Inbox statistics

`inbox_items` counts the owner's submissions received in the current Space during
that review's Monday-to-Monday interval, using the review's time zone. Pending,
accepted and discarded submissions all count once; revoking a token does not
remove its historical submissions. Capturing or explicitly refreshing a review
updates the count; closed reviews retain their snapshot. Only the integer count
enters weekly AI context, never inbox payloads or private ideas.

## Rollback

The table and column are new and ignored by v0.2. With the flag off, goals cannot be revised.
