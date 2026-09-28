# ADR-0048: PDF Preparation and Read-only Retrieval

- Status: Accepted
- Date: 2026-09-29
- Scope: research PDF preparation, encrypted cache and retrieval
- Related: ADR-0040 (WebDAV), ADR-0038 (online client), ADR-0039 (private resources)

## Context

Opening a PDF previously updated the resource hash, cache index and access time inside its GET.
On a cache miss, WebDAV download accounting also committed through a separate transaction.
Removing only the GET transaction's commit would therefore leave persistent side effects.

## Decision

- Add `POST .../library/resources/{resource_id}/pdf/prepare`, returning 204 after preparation.
  It uses the existing session, trusted Origin, CSRF, write rate limit, Space membership,
  resource ownership and credential revision checks. No permission is broadened.
- Preparation downloads only when the authorized cache binding is missing or stale, validates
  the PDF, records all received bytes (including rejected downloads), maintains encrypted cache
  entries and LRU timestamps, and stores the verified resource hash in the same existing flow.
- The existing GET checks those permissions and bindings on every request, reads and decrypts
  prepared ciphertext, and returns the existing PDF headers and bytes. It performs no database
  mutation, WebDAV request, cache eviction or access-time update. Missing or stale cache yields
  `PDF_NOT_PREPARED` (409); it cannot establish a binding from a guessed content hash.
- The reader prepares once before fetching each document. The preparation and fetch share the
  current cancellation signal; neither silently retries. Reopening a document prepares it again.
  Both requests retain the bounded PDF advisory lock; GET releases its read transaction when
  streaming ends. Preparation records recency even when the encrypted file is already cached.
- Cache quotas, TLS, host restrictions, encryption, ZIP validation, revocation, ownership and
  browser script restrictions remain unchanged. No migration or dependency is required.

## Compatibility and verification

The preparation route is an additive OpenAPI change. GET's successful response remains a PDF;
clients that may encounter a cold or stale cache must prepare first. The bundled reader does
this without adding a user action. Existing imported files may already have a usable binding.

Integration tests observe SQL during successful, cold-cache and missing-file GET requests and
require zero INSERT/UPDATE/DELETE statements and zero WebDAV calls. Preparation retains tests
for CSRF, Origin, cross-owner access, hash guessing, revocation, quota accounting, LRU eviction
and changed attachments. The real-backend reader suite checks the complete reading path.

## Operational requirements

Host and application proxies must both allow the configured PDF upload size and disable request
and response buffering for PDF import/retrieval. The host Nginx runbook documents this; changing
production Nginx remains a separate owner-approved operation.
