const CACHE_NAME = "logion-offline-shell-v2";
const PUBLIC_SHELL = ["/", "/offline"];
const STATIC_PREFIX = "/_next/static/";

// ADR-0035: cache only public, content-hashed stylesheets and fonts that the
// public shell references. No user data, API response or script is cached.
function staticReferences(text, pattern) {
  const found = new Set();
  for (const match of text.matchAll(pattern)) {
    const path = match[1];
    if (path.startsWith(STATIC_PREFIX)) found.add(path);
  }
  return [...found];
}

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(PUBLIC_SHELL);
  // Styles are best effort: the shell pages must install even if they fail.
  await cacheShellAssets(cache).catch(() => undefined);
}

async function cacheShellAssets(cache) {
  const styles = new Set();
  for (const path of PUBLIC_SHELL) {
    const response = await cache.match(path);
    if (!response) continue;
    for (const style of staticReferences(
      await response.text(),
      /href="(\/_next\/static\/[^"?#]+\.css)"/g,
    )) {
      styles.add(style);
    }
  }
  await cache.addAll([...styles]);
  const fonts = new Set();
  for (const style of styles) {
    const response = await cache.match(style);
    if (!response) continue;
    const base = new URL(style, self.location.origin);
    for (const match of (await response.text()).matchAll(
      /url\(["']?([^"')?#]+\.woff2)["']?\)/g,
    )) {
      const font = new URL(match[1], base);
      if (
        font.origin === self.location.origin &&
        font.pathname.startsWith(STATIC_PREFIX)
      ) {
        fonts.add(font.pathname);
      }
    }
  }
  await cache.addAll([...fonts]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  ) {
    return;
  }

  const url = new URL(event.request.url);
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const fallback = await caches.match(
          url.pathname === "/" ? "/" : "/offline",
        );
        return fallback ?? Response.error();
      }),
    );
    return;
  }

  if (url.pathname.startsWith(STATIC_PREFIX)) {
    event.respondWith(
      fetch(event.request).catch(
        async () => (await caches.match(event.request)) ?? Response.error(),
      ),
    );
  }
});
