# ADR-0041: AI Privacy Classes and Task Routing

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.3 AI-assisted reading, quizzes, link suggestions and weekly review
- Amends: ADR-0015 (AI routing and budget policy)
- Keeps: ADR-0013 (credential and network boundary), ADR-0016 (durable runs and draft isolation), ADR-0011's rule that AI cannot create experiments, metrics or formal conclusions
- Approval: in the 2026-09-27 kickoff the owner decided the following, and confirmed D1 the same day:
  - unpublished ideas and hypotheses are never sent to any cloud model or agent;
  - research questions may be sent;
  - translation uses an economical model, while close reading and quizzes use a stronger one.
- Accepted: the owner reviewed and accepted this record on 2026-09-27 (PR #269).

## Context

- The AI gateway already supports `openai_compatible` providers, per-workspace routing and budgets, send confirmation and draft acceptance.
- Reachability from the production host, checked 2026-09-27:
  - DeepSeek and GLM APIs are reachable;
  - `api.openai.com` times out.

## Decision

- **Private class**
  - A new `research_ideas` entity holds the owner's unpublished ideas and hypotheses.
  - No AI task and no agent interface may read it.
- **Context whitelist**
  - Each task has a context builder that may read only whitelisted entity types: source metadata, full text, excerpts, notes, research questions, topics and claims.
  - `research_ideas` is on no whitelist.
- **Outbound check**
  - Before a request leaves the server, the gateway checks every entity the payload references.
  - Any idea blocks the request with `AI_PRIVATE_CONTENT_BLOCKED`, and an audit event records the task kind and entity type only.
- **Task tiers**
  - Routing gains tasks mapped to tiers.
  - Economical tier: `translate` and `weekly_comment`.
  - Quality tier: `explain`, `close_reading`, `quiz_generate`, `quiz_grade` and `link_suggest`.
  - The workspace configures which provider and model serve each tier, resolved on the server.
- **Providers**
  - DeepSeek and GLM are configured as `openai_compatible` providers, and their API hosts are added to the outbound allowlist.
  - The quality-tier model is chosen after the R1 comparison on three papers.
  - OpenAI is not configured on the server.
- **Prompts as skills**
  - Each task's prompt is maintained as a `SKILL.md` under `packages/skills/`.
  - The server reads the same file that v0.3.1 exports to local agents.
- **Confirmation and budget**
  - Send confirmation stays, and the owner may switch it off per task.
  - Budgets and reservation are unchanged.

## Security

- **Two layers.** The whitelist prevents ideas from being read, and the outbound check catches mistakes in a builder. Tests cover both.
- **Audit.** It records task kind, entity types and counts, never prompt or response text.

## Rollback

Disable the task routes. Existing AI runs and drafts stay as ADR-0016 describes.
