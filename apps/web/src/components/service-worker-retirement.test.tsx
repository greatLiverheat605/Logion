/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { URL as NodeURL } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { retireServiceWorkers } from "./service-worker-retirement";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, "serviceWorker");
});

describe("service worker retirement", () => {
  it("unregisters every registration and deletes only Logion caches", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistrations: vi
          .fn()
          .mockResolvedValue([{ unregister }, { unregister }]),
      },
    });
    const deleted: string[] = [];
    vi.stubGlobal("caches", {
      keys: vi
        .fn()
        .mockResolvedValue([
          "logion-offline-shell-v2",
          "logion-auth-shell-v1",
          "unrelated-cache",
        ]),
      delete: vi.fn(async (key: string) => {
        deleted.push(key);
        return true;
      }),
    });

    await retireServiceWorkers();

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(deleted).toEqual([
      "logion-offline-shell-v2",
      "logion-auth-shell-v1",
    ]);
  });

  it("does nothing when the browser has no service worker or cache support", async () => {
    await expect(retireServiceWorkers()).resolves.toBeUndefined();
  });
});

describe("retired worker script", () => {
  it("handles no fetches and unregisters itself", () => {
    // jsdom replaces the global URL; node:fs needs Node's own.
    const script = readFileSync(
      new NodeURL("../../public/sw.js", import.meta.url),
      "utf8",
    );
    expect(script).not.toMatch(/addEventListener\(\s*["']fetch["']/);
    expect(script).toContain("self.registration.unregister()");
    expect(script).not.toMatch(/indexedDB/);
  });
});
