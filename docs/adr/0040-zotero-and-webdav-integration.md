# ADR-0040: Zotero and WebDAV Integration

- Status: Proposed
- Date: 2026-09-27
- Scope: v0.3 literature import and PDF access
- Related: ADR-0013 (AI provider credential boundary), ADR-0039 (unified source model)
- Approval: the owner chose Zotero plus Jianguoyun WebDAV storage on 2026-09-27, with read-only sync (D5) and local PDFs written to WebDAV (D2).

## Context

- The owner keeps literature in Zotero, with attachments synced to Jianguoyun (坚果云) WebDAV, and also has PDFs in local folders.
- Papers must be readable from any device, including public computers, without Logion becoming a file store.
- Reachability from the production host, checked 2026-09-27: `api.zotero.org` and `dav.jianguoyun.com` are reachable.
- The host has 2 vCPU and 1.6 GB of memory.

## Decision

- **Credentials**
  - The owner stores two credentials: a Zotero API key (read-only scope) and a Jianguoyun app password.
  - Both are encrypted server-side under the ADR-0013 keyring boundary in a new `integration_credentials` table.
  - Only the owner can set, test or revoke them. The API never returns them.
- **Metadata sync**
  - The worker pulls items, collections, tags and annotations incrementally by Zotero library version.
  - It runs every 30 minutes and on demand.
  - Sync is read-only: nothing is written back to Zotero.
- **Fetching PDFs**
  - Zotero stores each WebDAV attachment as `zotero/<key>.zip`.
  - The API streams the zip, checks size limits, unpacks it, verifies the `%PDF` header and serves the PDF to the owner.
- **Cache**
  - Fetched PDFs are cached encrypted on the attachments volume, keyed by file SHA-256, and indexed in `pdf_cache_entries`.
  - The cache is capped by `LOGION_PDF_CACHE_MAX_BYTES` (default 2 GB) with least-recently-used eviction.
  - Deleting a source deletes its cached file.
- **Local PDFs**
  - The owner drops files or a folder into the library.
  - The API writes each file to `Logion/<sha256>.pdf` on the owner's WebDAV and creates a source; duplicates are detected by hash.
- **Quota**
  - Monthly bytes downloaded from WebDAV are recorded, and the owner is warned before the free-tier limit (3 GB download per month).
  - Requests stay under 600 per 30 minutes.

## Security

- **Outbound traffic.** Only the two hosts above are allowed, and TLS verification stays on.
- **Hostile input.**
  - PDFs are treated as untrusted and rendered only in the browser by pdf.js with `isEvalSupported: false`.
  - Zip entries are size-bounded and path-checked.
- **Logs.** Titles, paths, credentials and file content do not appear in logs.
- **Server load.** The server does no PDF parsing beyond the header check.

## Rollback

- Revoke the credentials, which stops all sync and fetching.
- Clear the cache directory.
- Synced sources remain as ordinary rows.
