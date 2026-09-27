# ADR-0043: AI Comprehension Quiz and Mastery Boundary

- Status: Proposed
- Date: 2026-09-27
- Scope: v0.3 per-paper quizzes
- Keeps: ADR-0008 (private assessment), the invariant that AI suggestions never become mastery conclusions, ADR-0016 (draft isolation)
- Approval: in the 2026-09-27 kickoff the owner decided that AI writes and grades a quiz for each paper, and that mastery follows the owner's own judgment.

## Decision

- **Drafted questions**
  - For a source, AI drafts a set of questions, five by default.
  - They enter the AI draft area and become recall items only when the owner accepts them.
- **Item fields**
  - `quiz_items` gains `resource_id`, `origin` (`user` or `ai`) and `ai_run_id`.
  - The answer key stays on the server and is returned to the owner on reveal.
- **Grading**
  - After an attempt, AI grades it.
  - `quiz_attempts.ai_grade` stores the score, the reasoning and the weak concepts it found. The grade is evidence only.
- **Mastery**
  - Only the owner changes mastery, through the existing `MasteryRecord` flow.
  - Later reviews keep adjusting the schedule as they do today.
- **Privacy**
  - Grading context is the question, the answer key, the attempt and the source excerpts.
  - Ideas are never included (ADR-0041).

## Rollback

The new columns are ignored by v0.2. Accepted AI questions remain ordinary recall items.
