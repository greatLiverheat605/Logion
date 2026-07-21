# Notes and resource-index threat model

Status: L3-003A implementation baseline

## Invariants

- Notes and resources belong to one Workspace and Space; an optional task must belong to the same
  Workspace and Space.
- Markdown is stored as source text. It is never treated as trusted HTML; clients must render it as
  escaped text or pass it through the approved allowlist sanitizer.
- A resource stores a link or PDF metadata/page indexes only. This slice does not upload, fetch,
  parse or retain PDF binary/full-text content.
- Note bodies, titles, page notes and URLs are excluded from audit metadata and operational logs.

## Controls

| Threat                            | Control                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Cross-tenant IDOR                 | Membership and Space authorization precede every scoped query; hidden objects return not found        |
| Private Space disclosure          | Private Space resolution remains owner-only; Shared Space writes use the canonical permission         |
| CSRF/cross-origin writes          | Trusted Origin and double-submit CSRF checks on every create/update route                             |
| Over-posting or oversized content | Strict Pydantic DTOs, bounded Markdown/page indexes and database constraints                          |
| XSS through Markdown              | No server-side HTML generation and no client `dangerouslySetInnerHTML` without the approved sanitizer |
| Dangerous resource URL            | Only absolute HTTP/HTTPS URLs are accepted; the server does not dereference them                      |
| Lost updates                      | Expected versions and row locks; stale updates return a conflict                                      |
| Resource exhaustion               | Combined per-Space content quota and authenticated per-Workspace write rate limit                     |
| Audit leakage                     | Metadata allowlists contain only type, count, version and relation-presence flags                     |

## Follow-up

- L3-003B must encrypt note/resource payloads in the browser vault before entity, Outbox, conflict or
  Bootstrap storage.
- Any later URL health checker must add SSRF, redirect, DNS-rebinding and response-size defenses in a
  worker; accepting a stored link is not authorization to fetch it.
- Any later attachment/PDF upload must independently validate size, MIME, extension, hash and
  isolated object path before it can become evidence.
