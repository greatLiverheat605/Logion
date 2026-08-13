"use client";

/**
 * SSR-safe `useSyncExternalStore` adapters for a single CSS media query.
 *
 * The Inspector switches between a non-modal desktop sidebar and a modal mobile
 * sheet depending on viewport width. React's `useSyncExternalStore` requires
 * three pure functions:
 *
 * - `subscribe(onStoreChange)` — registers `onStoreChange` as a
 *   `MediaQueryList` change listener and returns a cleanup that removes the
 *   *same* listener.
 * - `getSnapshot()` — reads the current `matches` value on the client.
 * - `getServerSnapshot()` — returns a constant during SSR.
 *
 * Extracted into its own module so the subscribe/cleanup contract can be
 * unit-tested in isolation (changing `matches` and dispatching a `change`
 * event must notify the store; unmount must remove the listener).
 */

/**
 * Creates the three `useSyncExternalStore` adapters for a given media query.
 * Returns them as a stable object so callers can spread or destructure.
 */
export function createMediaQueryStore(query: string) {
  const subscribe = (onStoreChange: () => void): (() => void) => {
    if (typeof window === "undefined" || !window.matchMedia) {
      return () => undefined;
    }
    const mql = window.matchMedia(query);
    // Use the same listener reference for add and remove so cleanup is exact.
    if (mql.addEventListener) {
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    }
    // Legacy fallback (Safari < 14) — addListener/removeListener are deprecated
    // but the only option on very old engines.
    if (mql.addListener) {
      mql.addListener(onStoreChange);
      return () => mql.removeListener(onStoreChange);
    }
    return () => undefined;
  };

  const getSnapshot = (): boolean => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  };

  const getServerSnapshot = (): boolean => false;

  return { getServerSnapshot, getSnapshot, subscribe };
}
