import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("legacy local data migration", () => {
  let context: BrowserContext, page: Page, userId: string;
  const otherId = randomUUID();
  const calls: { action: string; name: string; mode?: string }[] = [];
  const name = (id: string) => `logion-offline-v1-${id}`;
  const seed = async (id: string, store = "outbox") =>
    page.evaluate(
      async ({ id, store }) => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(`logion-offline-v1-${id}`, 1);
          request.onupgradeneeded = () => {
            request.result.createObjectStore(store, { keyPath: "id" });
            request.result.createObjectStore("vaultRecords", { keyPath: "id" });
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const tx = db.transaction([store, "vaultRecords"], "readwrite");
            tx.objectStore(store).put({
              id: "one",
              encrypted_payload_ref: "synthetic-ciphertext-one",
            });
            tx.objectStore(store).put({
              id: "two",
              encrypted_payload_ref: "synthetic-ciphertext-two",
            });
            tx.objectStore("vaultRecords").put({
              id: "vault",
              ciphertext: "must-never-be-read",
            });
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onabort = () => reject(tx.error);
          };
        });
      },
      { id, store },
    );
  const count = async (id: string) =>
    page.evaluate(async (id) => {
      return await new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(`logion-offline-v1-${id}`);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("outbox", "readonly");
          const counted = tx.objectStore("outbox").count();
          tx.oncomplete = () => {
            db.close();
            resolve(counted.result);
          };
        };
      });
    }, id);
  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    });
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL! },
      data: {
        email: `legacy-data-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "合成本机迁移浏览器",
      },
    });
    expect(registered.status()).toBe(201);
    userId = (await registered.json()).user.id;
    const settings = (
      await (await context.request.get("/api/v1/users/me/settings")).json()
    ).settings;
    expect(
      (
        await context.request.put("/api/v1/users/me/settings", {
          headers: {
            Origin: baseURL!,
            "X-CSRF-Token": (await context.cookies()).find(
              (cookie) => cookie.name === "logion_csrf",
            )!.value,
          },
          data: {
            settings: [
              {
                key: "onboarding_completed",
                value: "true",
                version:
                  settings.find(
                    (setting: { key: string }) =>
                      setting.key === "onboarding_completed",
                  )?.version ?? 0,
              },
            ],
          },
        })
      ).status(),
    ).toBe(200);
    await context.exposeFunction(
      "observeLegacy",
      (value: (typeof calls)[number]) => {
        calls.push(value);
      },
    );
    await context.addInitScript(() => {
      const observe = (action: string, name: string, mode?: string) =>
        void (
          window as unknown as {
            observeLegacy: (value: {
              action: string;
              name: string;
              mode?: string;
            }) => Promise<void>;
          }
        ).observeLegacy({ action, name, mode });
      for (const method of ["open", "deleteDatabase"] as const) {
        const original = IDBFactory.prototype[method];
        Object.defineProperty(IDBFactory.prototype, method, {
          value: function (...args: unknown[]) {
            observe(method, String(args[0]), String(args[1] ?? "no-version"));
            return Reflect.apply(original, this, args);
          },
        });
      }
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        observe("transaction", this.name, args[1] ?? "readonly");
        return Reflect.apply(transaction, this, args);
      };
      for (const method of [
        "get",
        "getAll",
        "getAllKeys",
        "getKey",
        "openCursor",
        "openKeyCursor",
      ] as const) {
        const original = IDBObjectStore.prototype[method];
        Object.defineProperty(IDBObjectStore.prototype, method, {
          value: function (this: IDBObjectStore, ...args: unknown[]) {
            observe(method, this.name);
            return Reflect.apply(original, this, args);
          },
        });
      }
      const decrypt = crypto.subtle.decrypt;
      crypto.subtle.decrypt = function (...args) {
        observe("decrypt", "subtle");
        return Reflect.apply(decrypt, this, args);
      };
    });
    page = await context.newPage();
    await page.goto("/today");
    await expect(
      page.getByRole("heading", { name: "今日", exact: true }),
    ).toBeVisible();
    await seed(otherId);
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("unauthenticated checks never read storage and the sync marker grants no access", async ({
    browser,
    baseURL,
  }) => {
    const anonymous = await browser.newContext({ baseURL });
    let opened = 0;
    await anonymous.exposeFunction("recordAnonymousOpen", () => {
      opened++;
    });
    await anonymous.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        void (
          window as unknown as { recordAnonymousOpen: () => Promise<void> }
        ).recordAnonymousOpen();
        throw new Error("Anonymous storage access");
      };
    });
    const target = await anonymous.newPage();
    await target.goto("/legacy-data-check");
    await expect(target).toHaveURL(/\/auth\/login/);
    await target.goto("/app/sync?legacy=sync");
    await expect(
      target.getByRole("heading", { name: "需要登录", exact: true }),
    ).toBeVisible();
    expect((await anonymous.request.get("/api/v1/auth/session")).status()).toBe(
      401,
    );
    expect(opened).toBe(0);
    await anonymous.close();
  });

  test("absent current database redirects without creating it or touching another account", async () => {
    calls.length = 0;
    await page.goto("/app/records?untrusted=discarded");
    await expect(page).toHaveURL(/\/records$/);
    await expect(
      page.getByRole("heading", { name: "记录", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name),
      ),
    ).toEqual([name(otherId)]);
    expect(calls.filter((call) => call.action === "open")).toEqual([
      { action: "open", name: name(userId), mode: "no-version" },
    ]);
    expect(calls.some((call) => call.action === "deleteDatabase")).toBe(false);
    expect(await count(otherId)).toBe(2);
    await seed(userId);
  });

  test("counts only outbox without upgrading or decrypting and provides a working old sync entry", async () => {
    calls.length = 0;
    await page.goto("/app/research");
    await expect(page).toHaveURL(/\/legacy-data-check\?next=%2Flibrary$/);
    await expect(page.getByRole("status")).toHaveText("本机旧队列：2 条。");
    expect(
      calls.filter(
        (call) => call.action !== "open" && call.action !== "transaction",
      ),
    ).toEqual([]);
    expect(calls.filter((call) => call.action === "transaction")).toEqual([
      { action: "transaction", name: name(userId), mode: "readonly" },
    ]);
    expect(
      (await page.evaluate(async () => await indexedDB.databases())).find(
        (db) => db.name === name(userId),
      )?.version,
    ).toBe(1);
    await expect(
      page.getByRole("link", { name: "进入旧版同步" }),
    ).toHaveAttribute("href", "/app/sync?legacy=sync");
    const response = await context.request.get("/app/sync?legacy=sync", {
      maxRedirects: 0,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    await page.getByRole("link", { name: "进入旧版同步" }).click();
    await expect(page).toHaveURL(/\/app\/sync\?legacy=sync$/);
    await expect(
      page.getByRole("heading", { name: "同步诊断", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("本地解锁口令", { exact: true }),
    ).toBeVisible();
    await page.goto("/app/sync?tab=conflict");
    await expect(
      page.getByRole("heading", { name: "同步诊断", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/app\/sync\?tab=conflict$/);
    await page.goto("/legacy-data-check");
    await expect(page.getByRole("status")).toHaveText("本机旧队列：2 条。");
  });

  test("check and cleanup pages support four widths, both themes, keyboard and accessible confirmation", async ({}, info) => {
    for (const [path, title, prefix] of [
      ["/legacy-data-check", "旧数据检查", "legacy-check"],
      ["/settings/legacy-data", "本机旧数据", "legacy-settings"],
    ]) {
      await page.goto(path!);
      await expect(
        page.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("status")).toHaveText("本机旧队列：2 条。");
      await expect(page.locator(".wb-titlebar")).toContainText(
        path === "/legacy-data-check" ? "旧数据检查" : "设置",
      );
      for (const width of [320, 390, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
            [],
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          for (const control of await page
            .locator(".wb-legacy-data .wb-button")
            .all()) {
            expect(
              (await control.boundingBox())!.height,
            ).toBeGreaterThanOrEqual(44);
          }
          await page.screenshot({
            path: info.outputPath(`${prefix}-${width}-${theme}.png`),
            fullPage: true,
          });
        }
      }
    }
    const clear = page.getByRole("button", {
      name: "清除本机旧数据",
      exact: true,
    });
    await page.setViewportSize({ width: 390, height: 1000 });
    await clear.focus();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "确认清除", exact: true }),
    ).toBeDisabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(clear).toBeFocused();
    expect(await count(userId)).toBe(2);
    expect(await count(otherId)).toBe(2);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });

  test("storage denial and missing outbox cannot be mistaken for an empty queue", async () => {
    const unavailable = await context.newPage();
    await unavailable.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new DOMException("Storage access denied", "SecurityError");
      };
    });
    await unavailable.goto("/app/records");
    await expect(
      unavailable
        .getByRole("region", { name: "旧队列检查" })
        .getByRole("alert"),
    ).toBeVisible();
    await expect(unavailable).toHaveURL(/\/legacy-data-check/);
    await expect(
      unavailable.getByRole("link", { name: "进入旧版同步" }),
    ).toBeVisible();
    await unavailable.close();
    // A separate synthetic context has this user's session but a malformed local database.
    const corrupt = await context
      .browser()!
      .newContext({ baseURL: test.info().project.use.baseURL });
    await corrupt.addCookies(await context.cookies());
    const corruptPage = await corrupt.newPage();
    await corruptPage.goto("/today");
    await corruptPage.evaluate(
      async (id) =>
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open(`logion-offline-v1-${id}`, 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore("vaultRecords");
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
          request.onerror = () => reject(request.error);
        }),
      userId,
    );
    await corruptPage.goto("/app/records");
    await expect(
      corruptPage
        .getByRole("region", { name: "旧队列检查" })
        .getByRole("alert"),
    ).toContainText("缺少队列");
    await expect(corruptPage).toHaveURL(/\/legacy-data-check/);
    await corrupt.close();
  });

  test("a changed server identity prevents confirmed deletion", async () => {
    await page
      .getByRole("button", { name: "清除本机旧数据", exact: true })
      .click();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.route(
      "**/api/v1/auth/session",
      async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        body.user.id = otherId;
        await route.fulfill({ response, json: body });
      },
      { times: 1 },
    );
    await page.getByRole("button", { name: "确认清除", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "登录账户已变化",
    );
    expect(await count(userId)).toBe(2);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
  });

  test("blocked deletion stays pending then deletes only the confirmed account database", async () => {
    const holder = await context.newPage();
    await holder.goto("/today");
    await holder.evaluate(async (id) => {
      await new Promise<void>((resolve) => {
        const request = indexedDB.open(`logion-offline-v1-${id}`);
        request.onsuccess = () => {
          (window as unknown as { held: IDBDatabase }).held = request.result;
          resolve();
        };
      });
    }, userId);
    const beforeCookies = (await context.cookies()).map((c) => c.name).sort();
    await page
      .getByRole("button", { name: "清除本机旧数据", exact: true })
      .click();
    await page.getByRole("dialog").getByRole("checkbox").check();
    await page.getByRole("button", { name: "确认清除", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText(
      "清除尚未完成",
    );
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true }),
    ).toBeDisabled();
    expect(
      await holder.evaluate(() =>
        (
          window as unknown as { held: IDBDatabase }
        ).held.objectStoreNames.contains("outbox"),
      ),
    ).toBe(true);
    await holder.evaluate(() =>
      (window as unknown as { held: IDBDatabase }).held.close(),
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("旧数据已清除");
    expect(
      await page.evaluate(async () =>
        (await indexedDB.databases()).map((db) => db.name),
      ),
    ).toEqual([name(otherId)]);
    expect(await count(otherId)).toBe(2);
    expect((await context.cookies()).map((c) => c.name).sort()).toEqual(
      beforeCookies,
    );
    expect((await context.request.get("/api/v1/auth/session")).status()).toBe(
      200,
    );
    await holder.close();
    await page.goto("/app/records");
    await expect(page).toHaveURL(/\/records$/);
  });
});
