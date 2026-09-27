import { expect, test } from "@playwright/test";

test("web manifest exposes a standalone same-origin application", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as Record<string, unknown>;
  expect(manifest).toMatchObject({
    name: "Logion",
    start_url: "/",
    display: "standalone",
    lang: "zh-CN",
  });
});

test("an earlier service worker retires itself and leaves local data alone", async ({
  browserName,
  page,
}) => {
  test.skip(browserName !== "chromium", "Service-worker gate runs in Chromium");
  await page.goto("/");
  // ADR-0037: a browser that still has an earlier worker picks up /sw.js on
  // its next update check. Seed what such a browser holds: Logion caches, an
  // unrelated cache and IndexedDB data standing in for the local Vault.
  await page.evaluate(async () => {
    await (
      await caches.open("logion-offline-shell-v2")
    ).put("/offline", new Response("old shell"));
    await (
      await caches.open("unrelated-cache")
    ).put("/unrelated", new Response("unrelated"));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("logion-retirement-probe", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("records");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const transaction = open.result.transaction("records", "readwrite");
        transaction.objectStore("records").put("kept", "probe");
        transaction.onerror = () => reject(transaction.error);
        transaction.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });

  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBe(0);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).sort()))
    .toEqual(["unrelated-cache"]);
  const probe = await page.evaluate(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("logion-retirement-probe", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const read = open.result
            .transaction("records")
            .objectStore("records")
            .get("probe");
          read.onerror = () => reject(read.error);
          read.onsuccess = () => {
            open.result.close();
            resolve(read.result);
          };
        };
      }),
  );
  expect(probe).toBe("kept");

  // Loading the app never registers a worker again.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    )
    .toBe(0);
});
