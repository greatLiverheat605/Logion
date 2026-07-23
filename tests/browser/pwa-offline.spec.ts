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

test("installed shell falls back to the cached offline route", async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== "chromium", "Service-worker gate runs in Chromium");
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.goto("/not-cached-while-offline");
  await expect(
    page.getByRole("heading", { name: "当前处于离线状态" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "返回已缓存首页" }),
  ).toBeVisible();
});
