"use client";

import { useEffect } from "react";

const LOGION_CACHE_PREFIX = "logion-";

// ADR-0037: remove any service worker an earlier release registered, together
// with the caches it created. IndexedDB and other site data stay untouched.
export async function retireServiceWorkers(): Promise<void> {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations.map((registration) => registration.unregister()),
    );
  }
  if ("caches" in globalThis) {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(LOGION_CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    );
  }
}

export function ServiceWorkerRetirement() {
  useEffect(() => {
    void retireServiceWorkers().catch(() => undefined);
  }, []);

  return null;
}
