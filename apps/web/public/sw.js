// ADR-0037: Logion no longer runs a service worker. A browser that still has an
// earlier worker fetches this script on its next update check; this version
// replaces it, deletes the caches Logion created and unregisters itself. It
// handles no fetches and never touches IndexedDB or other site data.
const LOGION_CACHE_PREFIX = "logion-";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(LOGION_CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.registration.unregister()),
  );
});
