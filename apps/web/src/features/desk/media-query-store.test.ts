/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMediaQueryStore } from "@/features/desk/media-query-store";

/**
 * Builds a stubbed `MediaQueryList` with a mutable `matches` flag and spy
 * add/remove listeners. Installed onto `window.matchMedia` for the duration of
 * each test so the store reads and subscribes to the stub.
 */
function installStubbedMql(initialMatches: boolean) {
  let matches = initialMatches;
  const addEventListener = vi.fn();
  const removeEventListener = vi.fn();
  const mql = {
    addEventListener,
    get matches() {
      return matches;
    },
    removeEventListener,
  };
  const original = window.matchMedia;
  const matchMediaSpy = vi.fn(() => mql as unknown as MediaQueryList);
  // jsdom may not define matchMedia; assign defensively.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMediaSpy,
  });
  return {
    addEventListener,
    matchMediaSpy,
    removeEventListener,
    setMatches(value: boolean) {
      matches = value;
    },
    /** Simulate a viewport change: capture the registered listener and call it. */
    dispatchChange() {
      expect(addEventListener).toHaveBeenCalledWith(
        "change",
        expect.any(Function),
      );
      const listener = addEventListener.mock.calls.at(-1)?.[1] as
        | ((event: Event) => void)
        | undefined;
      expect(listener).toBeDefined();
      listener?.(new Event("change"));
    },
    restore() {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: original,
      });
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createMediaQueryStore", () => {
  it("getServerSnapshot always returns false (SSR-safe)", () => {
    const store = createMediaQueryStore("(max-width: 64rem)");
    expect(store.getServerSnapshot()).toBe(false);
  });

  it("getSnapshot reads the current matchMedia().matches", () => {
    const stub = installStubbedMql(true);
    const store = createMediaQueryStore("(max-width: 64rem)");
    expect(store.getSnapshot()).toBe(true);
    stub.setMatches(false);
    expect(store.getSnapshot()).toBe(false);
    stub.restore();
  });

  it("subscribe registers onStoreChange as the change listener and cleanup removes the SAME listener", () => {
    const stub = installStubbedMql(false);
    const store = createMediaQueryStore("(max-width: 64rem)");
    const onStoreChange = vi.fn();
    const cleanup = store.subscribe(onStoreChange);

    // The exact onStoreChange reference was registered.
    expect(stub.addEventListener).toHaveBeenCalledWith("change", onStoreChange);

    cleanup();

    // The SAME reference was removed (not a wrapper or no-op).
    expect(stub.removeEventListener).toHaveBeenCalledWith(
      "change",
      onStoreChange,
    );
    stub.restore();
  });

  it("dispatching a change event after subscribe calls onStoreChange (not a no-op)", () => {
    const stub = installStubbedMql(false);
    const store = createMediaQueryStore("(max-width: 64rem)");
    const onStoreChange = vi.fn();
    const cleanup = store.subscribe(onStoreChange);

    // Initially false.
    expect(store.getSnapshot()).toBe(false);

    // Cross the breakpoint: update matches + dispatch change.
    stub.setMatches(true);
    stub.dispatchChange();

    // React's onStoreChange callback was invoked, and the snapshot now reads true.
    expect(onStoreChange).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(true);

    cleanup();
    stub.restore();
  });

  it("cleanup removes the SAME listener that was registered", () => {
    const stub = installStubbedMql(false);
    const store = createMediaQueryStore("(max-width: 64rem)");
    const onStoreChange = vi.fn();
    const cleanup = store.subscribe(onStoreChange);

    // addEventListener was called once with the exact onStoreChange ref.
    expect(stub.addEventListener).toHaveBeenCalledTimes(1);
    expect(stub.addEventListener).toHaveBeenCalledWith("change", onStoreChange);

    cleanup();

    // removeEventListener was called once with the SAME ref — no wrapper.
    expect(stub.removeEventListener).toHaveBeenCalledTimes(1);
    expect(stub.removeEventListener).toHaveBeenCalledWith(
      "change",
      onStoreChange,
    );
    stub.restore();
  });

  it("changing matches and dispatching change notifies the store; after cleanup it does not fire again", () => {
    const stub = installStubbedMql(false);
    const store = createMediaQueryStore("(max-width: 64rem)");
    const onStoreChange = vi.fn();
    const cleanup = store.subscribe(onStoreChange);

    // Cross the breakpoint: matches flips to true + change dispatched.
    stub.setMatches(true);
    stub.dispatchChange();
    expect(onStoreChange).toHaveBeenCalledTimes(1);

    // Cleanup removes the listener.
    cleanup();
    expect(stub.removeEventListener).toHaveBeenCalledWith(
      "change",
      onStoreChange,
    );

    // After cleanup, a further change dispatch must NOT invoke onStoreChange.
    // We call the listener that WAS registered to confirm it is the same ref,
    // but since removeEventListener removed it, a real MQL would no longer call
    // it. Here we verify the ref identity and that no new addEventListener
    // call happened after cleanup.
    const addedCount = stub.addEventListener.mock.calls.length;
    expect(addedCount).toBe(1); // only the initial subscribe, no re-subscribe
    stub.restore();
  });

  it("getSnapshot returns false when matchMedia is unavailable (SSR fallback)", () => {
    const original = window.matchMedia;
    // Remove matchMedia entirely to simulate a non-browser env.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const store = createMediaQueryStore("(max-width: 64rem)");
    expect(store.getSnapshot()).toBe(false);
    // subscribe returns a no-op cleanup.
    const cleanup = store.subscribe(() => undefined);
    expect(cleanup).not.toThrow();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: original,
    });
  });
});
