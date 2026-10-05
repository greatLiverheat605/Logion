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
  test("normal logout preserves the identity cookie and a fresh login reuses it", async ({}, testInfo) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.goto("/today");
    await page.getByRole("button", { name: "打开导航", exact: true }).click();
    const logout = page
      .getByRole("dialog", { name: "导航", exact: true })
      .getByRole("button", { name: "退出登录", exact: true });
    const bounds = await logout.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath("mobile-navigation-logout-390.png"),
      fullPage: true,
    });
    await logout.click();
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
  test("private drafts recover explicitly, protect concurrent edits and clear on submit and logout", async ({}, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const workspace = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    const path = `/api/v1/workspaces/${workspace}/spaces/${space}/research/form-drafts/idea_create/00000000-0000-0000-0000-000000000000`;
    async function editor(target: Page) {
      await target.goto("/questions");
      await target
        .getByRole("radio", { name: "私人想法", exact: true })
        .click();
      await target
        .getByRole("button", { name: "新建想法", exact: true })
        .click();
      return target.getByRole("dialog");
    }
    let form = await editor(page);
    await form
      .getByLabel("标题", { exact: true })
      .fill("Confirm this title again");
    await form.getByLabel("想法正文").fill("SYNTHETIC_PRIVATE_FORM_DRAFT");
    await expect(form.getByRole("status")).toHaveText("私人草稿已保存。");
    await page.reload();
    form = await editor(page);
    await expect(form.getByLabel("想法正文")).toHaveValue("");
    await form.getByRole("button", { name: "恢复草稿", exact: true }).click();
    await expect(form.getByLabel("想法正文")).toHaveValue(
      "SYNTHETIC_PRIVATE_FORM_DRAFT",
    );
    await expect(form.getByLabel("标题", { exact: true })).toHaveValue("");
    await expect(
      form.getByText(
        "恢复仅覆盖长文本；请在提交前重新确认标题、日期、目标选择和处理动作等其他字段。",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("restored-draft-scope.png"),
      fullPage: true,
    });
    const second = await context.newPage();
    try {
      const secondForm = await editor(second);
      await secondForm
        .getByRole("button", { name: "恢复草稿", exact: true })
        .click();
      await form.getByLabel("想法正文").fill("First tab updated");
      await expect(form.getByRole("status")).toHaveText("私人草稿已保存。");
      await secondForm.getByLabel("想法正文").fill("Second tab preserved");
      await expect(secondForm.getByRole("alert")).toContainText(
        "草稿已在其他页面",
      );
      await expect(secondForm.getByLabel("想法正文")).toHaveValue(
        "Second tab preserved",
      );
      await secondForm.getByRole("button", { name: "重新检查草稿" }).click();
      await secondForm.getByRole("button", { name: "保留本页长文本" }).click();
      await expect(secondForm.getByRole("status")).toHaveText(
        "私人草稿已保存。",
      );
    } finally {
      await second.close();
    }
    await page.reload();
    form = await editor(page);
    await form.getByRole("button", { name: "恢复草稿", exact: true }).click();
    await expect(form.getByLabel("想法正文")).toHaveValue(
      "Second tab preserved",
    );
    await context.setOffline(true);
    try {
      await form.getByLabel("想法正文").fill("Offline page text retained");
      await expect(form.getByRole("alert")).toContainText("需要联网");
      await expect(form.getByLabel("想法正文")).toHaveValue(
        "Offline page text retained",
      );
    } finally {
      await context.setOffline(false);
    }
    await form.getByRole("button", { name: "重新检查草稿" }).click();
    await form.getByRole("button", { name: "保留本页长文本" }).click();
    await expect(form.getByRole("status")).toHaveText("私人草稿已保存。");
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`private-draft-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    await form.getByRole("button", { name: "丢弃服务器草稿" }).click();
    await expect(
      form.getByRole("button", { name: "丢弃服务器草稿" }),
    ).toHaveCount(0);
    expect((await (await context.request.get(path)).json()).draft).toBeNull();
    await expect(form.getByLabel("想法正文")).toHaveValue(
      "Offline page text retained",
    );
    await form.getByLabel("想法正文").fill("Submitted synthetic content");
    await form.getByLabel("标题", { exact: true }).fill("Draft acceptance");
    await form.getByRole("button", { name: "保存想法" }).click();
    await expect(form).toHaveCount(0);
    expect((await (await context.request.get(path)).json()).draft).toBeNull();
    form = await editor(page);
    await form.getByLabel("想法正文").fill("Delete on explicit sign out");
    await expect(form.getByRole("status")).toHaveText("私人草稿已保存。");
    await page.goto("/questions");
    const desktopLogout = page
      .getByRole("complementary", { name: "研究侧栏", exact: true })
      .getByRole("button", { name: "退出登录", exact: true });
    const desktopBounds = await desktopLogout.boundingBox();
    expect(desktopBounds?.height).toBeGreaterThanOrEqual(44);
    expect(desktopBounds?.width).toBeGreaterThanOrEqual(44);
    await desktopLogout.click();
    await expect(page).toHaveURL(/\/auth\/login/);
    expect(
      (
        await context.request.post("/api/v1/auth/login", {
          headers: { Origin: baseURL },
          data: payload,
        })
      ).status(),
    ).toBe(200);
    expect((await (await context.request.get(path)).json()).draft).toBeNull();
    expect(storageCalls).toBe(0);
  });
  test("sign-in choice sets session or persistent cookies and survives refresh", async () => {
    for (const remember of [false, true]) {
      await page.goto("/settings/security");
      await page
        .getByRole("main")
        .getByRole("button", { name: "退出登录", exact: true })
        .click();
      await expect(page).toHaveURL(/\/auth\/login/);
      await expect(
        page.getByLabel("保持登录", { exact: true }),
      ).not.toBeChecked();
      await page.getByLabel("邮箱", { exact: true }).fill(payload.email);
      await page.getByLabel("密码", { exact: true }).fill(payload.password);
      if (remember) await page.getByLabel("保持登录", { exact: true }).check();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/v1/auth/login") &&
          r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "登录", exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(page).not.toHaveURL(/\/auth\/login/);
      async function assertCookies() {
        const cookies = (await context.cookies()).filter((c) =>
          [
            "logion_access",
            "logion_refresh",
            "logion_csrf",
            "logion_device",
          ].includes(c.name),
        );
        expect(cookies).toHaveLength(4);
        for (const cookie of cookies) {
          if (remember)
            expect(cookie.expires).toBeGreaterThan(Date.now() / 1000);
          else expect(cookie.expires).toBe(-1);
        }
      }
      await assertCookies();
      const csrf = (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value;
      expect(
        (
          await context.request.post("/api/v1/auth/refresh", {
            headers: { Origin: baseURL, "X-CSRF-Token": csrf },
          })
        ).status(),
      ).toBe(200);
      await assertCookies();
    }
  });
});
