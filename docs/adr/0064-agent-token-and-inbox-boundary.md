# ADR-0064: Scoped Agent Tokens and Transactional Inbox Acceptance

- Status: Accepted within the owner-approved V1–V3 scope
- Date: 2026-09-29
- Related: ADR-0029, ADR-0041, ADR-0047

## Decision

`LOGION_AGENT_API_ENABLED` defaults to false and additionally requires the research
switch. Each PAT is bound to its owner and one selected workspace/space, has an
explicit expiry (at most 365 days), and grants only `read` and/or `inbox:write`.
Only a SHA-256 digest of a 32-byte random secret is persisted. The complete token
is returned once with no-store; lists contain no digest or secret. Session-only
creation/revocation require trusted Origin, CSRF and recent authentication.

PAT authentication exists only under `/api/v1/agent/`. A PAT cannot fall back to
session cookies or authenticate any existing endpoint. Every recognized token
request, including denial, is rate-limited and audited by token ID and a server-owned
operation name, without URLs, query values or content. Every request rechecks the
active user, email verification, membership and space visibility. Revocation and
scope changes cannot race an in-flight write past the authorization transaction.

Agent reads select explicit ADR-0041 fields from resources, texts, excerpts,
notes, research questions, topics and claims. They return no file locator,
credential or idea data. Unknown entity kinds fail closed. No graph traversal,
idea node, or idea edge is exposed. Payloads and pagination are bounded.

Four strict submission types are accepted: source, report, summary and edge.
Submission keys are unique per token; same key and body returns the prior item,
different bodies conflict. Submission only writes the private inbox. Owner review
uses the existing session boundary, a row lock and expected version. The accepted
payload and resulting entity receipt commit atomically; exact replay is idempotent.
The original proposal remains available separately from the owner's edited payload.

- Source entries become owner-private library resources, using the existing metadata
  validation, DOI/arXiv/PMID duplicate checks and quotas. They cannot inject file or
  Zotero locators. Duplicate sources remain pending for the owner to edit or discard.
- Reports and summaries become owner-private Yjs notes. An additive
  `notes.agent_inbox_item_id` provenance column distinguishes them while keeping
  the old `note_kind` contract unchanged. They use a separate session-only editor;
  old sync never receives their content. The normal records list can display them.
- Accepted edges are the owner's explicit confirmation (`origin=user`, confirmed),
  with the external origin retained in the inbox receipt. They cannot impersonate an
  internal AI run or revive a rejected edge identity. Endpoints and excerpt ownership
  are checked at submission and again at acceptance. Ideas are forbidden on both paths.

New tables and note provenance are additive. Downgrade refuses any new user data.
Account deletion revokes PATs and clears inbox state after dependent private notes
through the already approved account lifecycle. Existing export formats and OpenAPI
paths/schemas do not change. Accepted notes remain in research exports.

## Rollback and verification

Disable the Agent switch and revoke tokens. Keep inbox items and accepted records.
Do not downgrade populated tables. Refresh the independent rollback A schema pin
and run its privacy/compatibility suite before the final release candidate.

Tests cover token expiry/revocation/scopes, cookie isolation, cross-owner and shared
space privacy, absent idea sentinel output, concurrent/idempotent acceptance,
transaction rollback, migration downgrade refusal and the stdio-to-library flow.
