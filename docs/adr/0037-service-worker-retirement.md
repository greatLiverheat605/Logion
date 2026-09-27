# ADR-0037: Service Worker Retirement

- Status: Accepted
- Date: 2026-09-27
- Scope: v0.2.4 production fix for the defects found in the 2026-09-27 production acceptance of ADR-0035
- Supersedes: ADR-0035 (offline fallback page), for the service worker only
- Approval: the owner approved retiring the service worker on 2026-09-27. This was decision D3 of the v0.3 plan, which moves Logion to online-only use.

## Context

- **Offline fallback failed.** In production, opening a page offline showed the generic error page instead of the ADR-0035 fallback. The browser still held some scripts from an earlier visit; the page started, its lazy chunks could not load, and the error boundary took over.
- **Stylesheets downloaded twice.** The worker answered every `/_next/static/` request. Chromium then reported each preloaded stylesheet as unused and downloaded it again.
- **The owner chose online-only use for v0.3.** The next release will not have offline editing or an offline shell, so repairing the fallback would be wasted work.

## Decision

- **No registration.** The application no longer registers a service worker.
- **Page-side cleanup.** On every page load, the application does the following:
  - unregisters any service worker an earlier release registered;
  - deletes the Cache Storage entries whose names start with `logion-`.
- **Retirement worker at `/sw.js`.** A browser that still runs an earlier worker fetches this script on its next update check. The new script:
  - activates at once;
  - deletes the same caches;
  - unregisters itself;
  - has no `fetch` handler, so from activation on every request goes to the network.
- **Local data stays.** Neither path touches IndexedDB, the encrypted local Vault, the Outbox, form drafts or any cache that does not start with `logion-`.
- **Offline behavior.** Opening a page offline now shows the browser's own offline message. Pages that are already open keep working as before. `/offline` remains an ordinary online page.

## Consequences

- Chromium no longer reports unused stylesheet preloads, and stylesheets download once.
- Installed PWA and Android TWA shells still start online. Offline cold start was never supported for protected pages.
- ADR-0035's content rules for `/offline` still describe that page. Its caching rules no longer apply.

## Rollback

Revert this change. The previous worker registers again on the next page load.
