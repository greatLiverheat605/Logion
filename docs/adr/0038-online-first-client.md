# ADR-0038: Online-First Client

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.3 web client; the server-side sync-v1 endpoints stay until v0.3.1
- Supersedes: ADR-0003 (offline-first sync protocol) for the client, ADR-0026 (durable sync conflict resolution) for the new client, ADR-0034 (encrypted form drafts)
- Related: ADR-0002 (browser authentication and session boundary), ADR-0037 (service worker retirement)
- Approval: in the 2026-09-27 kickoff the owner chose online-only use, and approved the v0.3 plan the same day.
- Accepted: the owner reviewed and accepted this record on 2026-09-27 (PR #269).

## Context

- **Cost of offline-first.** Every workbench implements the local Vault, the Outbox, bootstrap, decryption and conflict handling on its own; 48 web files import `@logion/offline`. The 2026-09-27 production acceptance traced several defects to this:
  - unlock entries differ from page to page;
  - after a refresh the passphrase has to be entered again;
  - the Space selection is not shared between pages;
  - requests are duplicated.
- **Usage does not need it.** The owner reads on a computer, on public computers and on a phone, always online. A public computer should not keep an encrypted copy of personal data at all.
- **The server already has the data.** Business data is stored on the server as it is today. The local Vault encrypts the browser copy; it is not end-to-end encryption.

## Decision

- **No local storage of business data**
  - The v0.3 web client does not store business data in IndexedDB.
  - It does not register a service worker (ADR-0037) and has no local passphrase.
  - Reads and writes go to the REST API through one shared data layer with a query cache.
- **Offline state**
  - When the network is unavailable, the client says so and does not queue writes.
  - A failed save keeps the form content on screen.
- **Form drafts**
  - Long-text forms autosave to a server-side draft owned by the user.
  - A draft expires after 7 days and is deleted on submit, discard or sign-out.
  - Drafts never sync to other users, and audit records only the form kind.
- **"Keep me signed in"**
  - It becomes an explicit choice at sign-in. Without it the session ends when the browser closes, which is the default recommended on public computers.
  - Session lifetimes, refresh, recent-auth, CSRF, Origin checks and Workspace/Space permissions are unchanged.
- **Retiring existing local data** (details in the v0.3 migration plan)
  - Before the release, the owner confirms every device is fully synced.
  - At release, legacy routes pass through a check page. It counts the Outbox entries without decrypting them and blocks the redirect while any remain.
  - Settings offers "clear old local data". It runs only after explicit confirmation and never automatically.

## Security

- **Improved.** Personal data no longer rests in browsers, including public computers.
- **Unchanged.**
  - Server-side storage is as before: plaintext business data in PostgreSQL, encrypted backups (ADR-0022), encrypted AI credentials (ADR-0013).
  - Authentication and authorization boundaries are untouched.
- **Lost.** Reading and editing without a network. The owner accepted this.

## Rollback

- Turn `LOGION_RESEARCH_V3_ENABLED` off. `/app/*` serves the legacy client again, and its offline behavior still works with the retained sync-v1 endpoints.
- Server drafts are ordinary rows and can be dropped.
