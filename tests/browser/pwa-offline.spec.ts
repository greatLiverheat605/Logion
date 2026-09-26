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

test("installed shell falls back to a styled offline page that works without scripts", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== "chromium", "Service-worker gate runs in Chromium");
  await page.goto("/");
  await page.evaluate(async () => {
    // A cache left by the previous worker version must be removed on activation.
    await (
      await caches.open("logion-auth-shell-v1")
    ).put("/legacy", new Response("legacy"));
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const cache = await caches.open("logion-offline-shell-v2");
    const paths = (await cache.keys()).map(
      (request) => new URL(request.url).pathname,
    );
    return { names, paths };
  });
  expect(cached.names).toEqual(["logion-offline-shell-v2"]);
  expect(cached.paths).toEqual(expect.arrayContaining(["/", "/offline"]));
  expect(
    cached.paths.some((path) => /^\/_next\/static\/.+\.css$/.test(path)),
  ).toBe(true);
  // Only the public shell and its static assets; never API responses or scripts.
  expect(
    cached.paths.filter(
      (path) =>
        !["/", "/offline"].includes(path) && !path.startsWith("/_next/static/"),
    ),
  ).toEqual([]);
  expect(cached.paths.some((path) => path.endsWith(".js"))).toBe(false);

  await context.setOffline(true);
  await page.goto("/app/today");
  await expect(
    page.getByRole("heading", { name: "暂时无法打开这个页面" }),
  ).toBeVisible();
  await expect(page.getByText("本页不会读取或显示这些资料。")).toBeVisible();
  await expect(page.getByRole("link", { name: "返回首页" })).toBeVisible();
  // The cached stylesheet applies even though no network request succeeds.
  expect(
    await page.evaluate(() =>
      [...document.styleSheets].some(
        (sheet) =>
          sheet.href?.includes("/_next/static/") && sheet.cssRules.length > 0,
      ),
    ),
  ).toBe(true);

  await context.setOffline(false);
  await page.getByRole("button", { name: "重新打开此页" }).click();
  await expect(page).toHaveURL(/\/app\/today\??$/);
  await expect(
    page.getByRole("heading", { name: "暂时无法打开这个页面" }),
  ).toHaveCount(0);
});
