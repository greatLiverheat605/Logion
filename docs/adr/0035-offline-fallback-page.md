# ADR-0035: Offline Fallback Page

- Status: Accepted
- Date: 2026-09-26
- Scope: N3-C option A, the public page shown when a navigation fails offline
- Related: ADR-0002 (browser authentication and session boundary), ADR-0034 (encrypted form drafts)
- Approval: the owner approved option A on 2026-09-26. Option B (an offline read-only mode) is not in scope.

## Context

- `apps/web/public/sw.js` caches `/` and `/offline` at install. A failed navigation to `/` returns the cached home page; every other path returns the cached `/offline`.
- The worker cached no `_next/static` files. Offline, the cached page therefore rendered without its stylesheet, and its only retry control needed JavaScript that could not load.
- The page did not say why the requested page could not open, whether data on the device was still there, or how to continue.
- Protected routes (`/app/*`) need the server to confirm the session, so they cannot open offline. That boundary stays.

## Decision

- **Static assets for the shell**
  - At install, the worker also caches the stylesheets that the cached `/` and `/offline` HTML reference, and the fonts those stylesheets load.
  - These are content-hashed public build files. They hold no user data, API responses or session information.
- **Network first**
  - Same-origin `GET` requests under `/_next/static/` go to the network. Only when the network fails does the worker answer from the cache.
  - Scripts are not cached. The page works without JavaScript.
- **Cache version**: the cache name changes to `logion-offline-shell-v2`, and activation deletes older caches.
- **Content**
  - The requested page needs the server to confirm the sign-in and permissions, so it cannot open offline.
  - Encrypted notes, tasks, review records, unsent changes and form drafts stay in this browser. This page neither reads nor shows them.
  - A page that was already open and unlocked in another tab keeps saving locally.
  - To continue: reopen the page once online, unlock local data, then check the sync center for unsent changes and conflicts.
  - Do not clear site data or uninstall the app before syncing.
- **Controls without JavaScript**
  - "重新打开此页" is a native form that reloads the current address.
  - "返回首页" opens the cached home page.
  - "联网后打开同步中心" needs the network.

## Rejected here

- Caching protected routes or scripts, skipping session verification, or reading local data offline. These are option B or C of the N3-C evaluation, and would change the authentication boundary or the CSP model.

## Rollback

Revert `sw.js` and the page. The cache name changes on the next install, which removes the v2 cache.
