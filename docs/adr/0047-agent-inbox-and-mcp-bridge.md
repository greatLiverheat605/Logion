# ADR-0047: Agent Inbox, Personal Access Tokens and MCP Bridge

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.3.1
- Related: ADR-0029 (local worker protocol), ADR-0041 (privacy classes)
- Approval: in the 2026-09-27 kickoff the owner decided on the agent rules:
  - Codex and Claude Code may read;
  - their writes go to an inbox and reach the library only after the owner reviews them;
  - agents cannot delete;
  - MCP comes first.
- Accepted: the owner reviewed and accepted this record on 2026-09-27 (PR #269).

## Decision

- **Personal access tokens**
  - Only the owner creates them, each with an expiry, and can revoke them at any time.
  - Only a hash is stored.
  - Scopes are `read`, limited by the ADR-0041 whitelist, and `inbox:write`.
  - No token can delete or modify records, or reach account, security, AI credential, integration credential or idea endpoints.
- **Inbox**
  - `agent_inbox_items` holds research reports, source entries, summaries and suggested edges.
  - The owner accepts, edits then accepts, or discards each item. Only acceptance writes to the library, knowledge network or notes.
- **MCP bridge**
  - `packages/mcp-bridge` is a local stdio MCP server run on the owner's computer that calls the REST API with a token.
  - Codex and Claude Code both mount it.
- **Audit and limits.** Every token request is audited by token ID and endpoint, and rate-limited per token.
- **Before building.** Evaluate whether ADR-0029's local worker leases and result receipts can carry agent submissions.

## Rollback

Revoke all tokens. Inbox items stay until the owner discards them.

## Local Worker evaluation (2026-09-29)

ADR-0029 binds a local Worker to a specific job, workspace, space and input hash,
with a lease of at most 600 seconds and claimed/running/uploaded checkpoints.
Its result receipts carry output hashes, not literature or note payloads. Reuse
its security mechanisms (random tokens stored only as digests, current permission
checks, unique idempotency receipts and transactional acceptance), but keep PATs
and inbox submissions separate. Extending the lease protocol would widen the old
Worker's authority and force an unrelated execution lifecycle onto MCP reads.
The local Worker routes, switches and contracts remain unchanged.

The implementation boundary and acceptance mappings are specified in ADR-0064.
