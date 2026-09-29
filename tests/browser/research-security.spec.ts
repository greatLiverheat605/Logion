import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("online device hygiene", () => {
  let context: BrowserContext,
    other: BrowserContext,
    sameDevice: BrowserContext,
    page: Page,
    baseURL: string;
  let deviceId: string;
  let storageCalls = 0;
  const payload = {
    email: `security-${randomUUID()}@example.com`,
    password: `${randomBytes(24).toString("base64url")}Aa1!`,
    device_name: "当前合成浏览器",
  };
  test.beforeAll(async ({ browser, baseURL: origin }) => {
    baseURL = origin!;
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    });
    other = await browser.newContext({ baseURL });
    sameDevice = await browser.newContext({ baseURL });
    await context.exposeFunction("recordLegacyStorage", () => {
      storageCalls += 1;
    });
    await context.addInitScript(() => {
      for (const name of ["open", "deleteDatabase"] as const) {
        const original = IDBFactory.prototype[name];
        Object.defineProperty(IDBFactory.prototype, name, {
          value: function (...args: unknown[]) {
            void (
              window as unknown as { recordLegacyStorage: () => Promise<void> }
            ).recordLegacyStorage();
            return Reflect.apply(original, this, args);
          },
        });
      }
    });
    page = await context.newPage();
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL },
      data: payload,
    });
    expect(registered.status()).toBe(201);
    deviceId = (await context.cookies()).find(
      (c) => c.name === "logion_device",
    )!.value;
    expect(
      (
        await other.request.post("/api/v1/auth/login", {
          headers: { Origin: baseURL },
          data: { ...payload, device_name: "另一台合成浏览器" },
        })
      ).status(),
    ).toBe(200);
    await sameDevice.addCookies(
      (await context.cookies()).filter((c) => c.name === "logion_device"),
    );
    expect(
      (
        await sameDevice.request.post("/api/v1/auth/login", {
          headers: { Origin: baseURL },
          data: payload,
        })
      ).status(),
    ).toBe(200);
  });
  test.afterAll(async () => {
    await context?.close();
    await other?.close();
    await sameDevice?.close();
  });
  const dialog = () => page.getByRole("dialog");
  const devices = () =>
    page.getByRole("region", { name: "登录设备", exact: true });
  test("security supports four widths and themes, keyboard access and no legacy storage", async ({}, testInfo) => {
    await page.goto("/settings");
    await page.getByRole("link", { name: "设备与会话", exact: false }).click();
    await expect(devices().getByRole("listitem")).toHaveCount(2);
    await expect(devices()).toContainText("另一台合成浏览器");
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (width <= 390)
          expect(
            (await page
              .getByRole("button", { name: "退出其他所有会话", exact: true })
              .boundingBox())!.height,
          ).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(`security-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    const button = page.getByRole("button", {
      name: "退出其他所有会话",
      exact: true,
    });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(dialog()).toBeVisible();
    await expect(
      dialog().getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
    await expect(button).toBeFocused();
    expect(storageCalls).toBe(0);
    expect(
      await page.evaluate(async () => await indexedDB.databases()),
    ).toEqual([]);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });
  test("cancel preserves sessions; confirmation logs out both other-device and same-device sessions", async () => {
    await page
      .getByRole("button", { name: "退出其他所有会话", exact: true })
      .click();
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    expect((await other.request.get("/api/v1/auth/session")).status()).toBe(
      200,
    );
    expect(
      (await sameDevice.request.get("/api/v1/auth/session")).status(),
    ).toBe(200);
    await page
      .getByRole("button", { name: "退出其他所有会话", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "确认操作", exact: true })
      .click();
    await expect(dialog()).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("其他会话已退出");
    await expect(devices().getByRole("listitem")).toHaveCount(1);
    expect((await other.request.get("/api/v1/auth/session")).status()).toBe(
      401,
    );
    expect(
      (await sameDevice.request.get("/api/v1/auth/session")).status(),
    ).toBe(401);
    expect((await context.request.get("/api/v1/auth/session")).status()).toBe(
      200,
    );
  });
  test("a device can sign in again and explicit revocation ends its new session", async () => {
    expect(
      (
        await other.request.post("/api/v1/auth/login", {
          headers: { Origin: baseURL },
          data: { ...payload, device_name: "另一台合成浏览器" },
        })
      ).status(),
    ).toBe(200);
    await page.getByRole("button", { name: "刷新设备", exact: true }).click();
    const row = devices()
      .getByRole("listitem")
      .filter({ hasText: "另一台合成浏览器" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "撤销设备", exact: true }).click();
    await expect(dialog()).toContainText("另一台合成浏览器");
    await dialog()
      .getByRole("button", { name: "确认操作", exact: true })
      .click();
    await expect(dialog()).toHaveCount(0);
    await expect(row).toHaveCount(0);
    expect((await other.request.get("/api/v1/auth/session")).status()).toBe(
      401,
    );
  });
  test("normal logout preserves the identity cookie and a fresh login reuses it", async () => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "logion_device")?.value).toBe(
      deviceId,
    );
    expect(
      cookies.some((c) =>
        ["logion_access", "logion_refresh", "logion_csrf"].includes(c.name),
      ),
    ).toBe(false);
    expect((await context.request.get("/api/v1/auth/session")).status()).toBe(
      401,
    );
    expect(storageCalls).toBe(0);
    expect(
      (
        await context.request.post("/api/v1/auth/login", {
          headers: { Origin: baseURL },
          data: payload,
        })
      ).status(),
    ).toBe(200);
    expect(
      (await context.cookies()).find((c) => c.name === "logion_device")?.value,
    ).toBe(deviceId);
    await page.goto("/settings/security");
    await expect(devices().getByRole("listitem")).toHaveCount(1);
    await expect(devices()).toContainText("当前设备");
    expect(storageCalls).toBe(0);
  });
});
