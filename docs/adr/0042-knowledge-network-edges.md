# ADR-0042: Knowledge Network Edges

- Status: Proposed
- Date: 2026-09-27
- Scope: v0.3 knowledge network of research questions, topics, sources, claims and ideas
- Related: ADR-0029 (knowledge citations), ADR-0036 (topic dependencies), ADR-0041 (privacy classes)
- Approval: in the 2026-09-27 kickoff the owner decided that:
  - the network is organized by research question and concept;
  - AI proposes the links;
  - unconfirmed links show as dashed lines and confirmed ones as solid.

## Context

- **What exists.**
  - `TopicDependency` records prerequisites between topics.
  - `KnowledgeCitation` ties an excerpt to one topic, recall item, claim or note.
- **What is missing.** Nothing connects a paper to a research question, or one paper to another.

## Decision

- **Table and endpoints**
  - A new `knowledge_edges` table has typed endpoints `from_type`/`from_id` and `to_type`/`to_id`.
  - Endpoint types are `question`, `topic`, `resource`, `claim` and `idea`.
  - All endpoints must lie in the same Workspace and Space, and belong to the same user for personal research data.
- **Relations**
  - Source to question: `addresses`.
  - Source to topic: `defines` and `uses`.
  - Source to source: `extends`, `contradicts` and `supersedes`.
  - Claim to question: `supports` and `challenges`.
  - Idea to source: `inspired_by`.
  - Topic prerequisites stay in `TopicDependency`; they are not duplicated here.
- **Status**
  - `suggested` shows as dashed, `confirmed` as solid, and `rejected` is hidden and never suggested again.
  - AI may create only `suggested` edges, with its run ID and a one-sentence reason.
  - Only the owner can confirm or reject an edge.
- **Ideas**
  - Edges touching an idea can be created only by hand.
  - AI never reads them (ADR-0041).
- **Uniqueness.** There is at most one edge per endpoint pair and relation, whatever its status.
- **Evidence.** An edge may point to an excerpt as evidence through `evidence_excerpt_id`.

## Rollback

The table is new, and the v0.2 application does not read it.
