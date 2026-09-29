import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("mobile navigation and sectioned reading", () => {
  let context: BrowserContext, page: Page, resource: string, scope: string;
  let storageCalls = 0;
  const stored = async () =>
    await (
      await context.request.get(`${scope}/library/resources/${resource}/note`)
    ).json();
  const openNote = async (target: Page) => {
    await target.goto(`/read/${resource}`);
    await expect(
      target.getByRole("heading", { name: "五角度精读笔记" }),
    ).toBeVisible();
    await expect(
      target.getByRole("textbox", { name: "动机内容", exact: true }),
    ).toBeVisible();
  };
  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    });
    await context.exposeFunction("recordMobileStorage", () => {
      storageCalls++;
    });
    await context.addInitScript(() => {
      for (const name of ["open", "deleteDatabase"] as const) {
        const original = IDBFactory.prototype[name];
        Object.defineProperty(IDBFactory.prototype, name, {
          value: function (...args: unknown[]) {
            void (
              window as unknown as { recordMobileStorage: () => Promise<void> }
            ).recordMobileStorage();
            return Reflect.apply(original, this, args);
          },
        });
      }
    });
    expect(
      (
        await context.request.post("/api/v1/auth/register", {
          headers: { Origin: baseURL! },
          data: {
            email: `mobile-reading-${randomUUID()}@example.com`,
            password: `${randomBytes(24).toString("base64url")}Aa1!`,
            device_name: "合成分节阅读浏览器",
          },
        })
      ).status(),
    ).toBe(201);
    const headers = {
      Origin: baseURL!,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
    const ws = (await (await context.request.get("/api/v1/workspaces")).json())
      .workspaces[0].id;
    const sp = (
      await (
        await context.request.get(`/api/v1/workspaces/${ws}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${ws}/spaces/${sp}`;
    expect(
      (
        await context.request.put("/api/v1/research/integrations/webdav", {
          headers,
          data: {
            username: "synthetic-account",
            credential: "synthetic-webdav",
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.request.post(
          "/api/v1/research/integrations/webdav/test",
          { headers },
        )
      ).status(),
    ).toBe(200);
    const imported = await context.request.post(
      `${scope}/library/resources/pdf-import`,
      {
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "X-PDF-Title": encodeURIComponent("分节阅读合成论文"),
        },
        data: await readFile("tests/fixtures/synthetic-reader.pdf"),
      },
    );
    expect(imported.status()).toBe(201);
    resource = (await imported.json()).id;
    expect(
      (
        await context.request.post(
          `${scope}/library/resources/${resource}/note`,
          { headers },
        )
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.request.put("/api/v1/users/me/settings", {
          headers,
          data: {
            settings: [
              { key: "reader.hint_dismissed", value: "true", version: 0 },
            ],
          },
        })
      ).status(),
    ).toBe(200);
    page = await context.newPage();
    await page.goto(`/read/${resource}`);
    await page.getByRole("button", { name: "选择右栏内容" }).click();
    await page.getByRole("menuitem", { name: "精读笔记" }).click();
    await expect(
      page.getByRole("textbox", { name: "动机内容", exact: true }),
    ).toBeVisible();
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("two tabs edit different sections without losing either change or resetting Yjs", async () => {
    const initial = await stored();
    const other = await context.newPage();
    await openNote(other);
    await page
      .getByRole("textbox", { name: "动机内容", exact: true })
      .fill("本人动机与证据😀");
    await expect
      .poll(async () => (await stored()).markdown_body)
      .toContain("本人动机与证据😀");
    await other
      .locator("summary")
      .filter({ hasText: /^建模$/ })
      .click();
    await other
      .getByRole("textbox", { name: "建模内容", exact: true })
      .fill("另一标签页的模型与假设。");
    await expect
      .poll(async () => (await stored()).markdown_body)
      .toContain("另一标签页的模型与假设。");
    const merged = await stored();
    expect(merged.markdown_body).toContain("本人动机与证据😀");
    expect(merged.yjs_generation).toBe(initial.yjs_generation);
    await other.close();
    await openNote(page);
    await expect(
      page.getByRole("textbox", { name: "动机内容", exact: true }),
    ).toHaveValue("本人动机与证据😀");
    await page
      .locator("summary")
      .filter({ hasText: /^建模$/ })
      .click();
    await expect(
      page.getByRole("textbox", { name: "建模内容", exact: true }),
    ).toHaveValue("另一标签页的模型与假设。");
    await page
      .locator("summary")
      .filter({ hasText: /^建模$/ })
      .click();
  });

  test("section typing during an in-flight save and old custom content both survive", async () => {
    let release!: () => void, received!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(
      `**/library/resources/${resource}/note/document`,
      async (route) => {
        const response = await route.fetch();
        received();
        await blocked;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const editor = page.getByRole("textbox", { name: "动机内容", exact: true });
    await editor.fill("保存中第一段");
    await started;
    await editor.fill("保存中第一段\n继续输入第二段😀");
    release();
    await expect
      .poll(async () => (await stored()).markdown_body)
      .toContain("保存中第一段\n继续输入第二段😀");
    await expect(
      page.locator(".wb-close-reading").getByRole("status"),
    ).toHaveText("已保存");
    await page.getByText("完整 Markdown 与自定义内容", { exact: true }).click();
    const raw = page.getByRole("textbox", { name: "精读笔记正文" });
    const original =
      "旧前言。\n\n" +
      (await raw.inputValue()) +
      "## 我的额外证据\n完整保留😀\n";
    await raw.fill(original);
    await expect
      .poll(async () => (await stored()).markdown_body)
      .toBe(original);
    await page.getByText("完整 Markdown 与自定义内容", { exact: true }).click();
    await editor.fill("保存中第一段\n继续输入第二段😀\n追加新证据");
    await expect
      .poll(async () => (await stored()).markdown_body)
      .toContain("追加新证据");
    const result = (await stored()).markdown_body;
    expect(result.startsWith("旧前言。\n\n")).toBe(true);
    expect(result.endsWith("## 我的额外证据\n完整保留😀\n")).toBe(true);
  });

  test("seven sections, title progress and mobile tabs work at four widths in both themes", async ({}, testInfo) => {
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width < 768)
        await page.getByRole("radio", { name: "右 · 精读笔记" }).click();
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await page.locator(".wb-close-reading h2").scrollIntoViewIfNeeded();
        await expect(page.locator(".wb-close-reading h2")).toBeInViewport();
        await expect(page.locator(".wb-note-sections summary")).toHaveText([
          "动机",
          "建模",
          "实验",
          "结论",
          "批判",
          "一句话要点",
          "待解决问题",
          "完整 Markdown 与自定义内容",
        ]);
        await expect(
          page.locator(".wb-reader-heading").getByRole("status"),
        ).toContainText("阅读状态：");
        const nav = page.getByRole("navigation", { name: "快捷导航" });
        if (width < 768) {
          await expect(nav.getByRole("link")).toHaveText([
            "复习",
            "笔记",
            "文献",
            "知识网",
          ]);
          for (const link of await nav.getByRole("link").all())
            expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(
              44,
            );
          for (const button of await page
            .locator(
              '.wb-pane-group[data-mobile-active="true"] .wb-pane-header button',
            )
            .all()) {
            const box = (await button.boundingBox())!;
            expect(box.width).toBeGreaterThanOrEqual(44);
            expect(box.height).toBeGreaterThanOrEqual(44);
          }
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`sectioned-reading-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    expect(storageCalls).toBe(0);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });

  test("phone navigation opens notes, literature and a read-only graph; resizing closes editors", async () => {
    await page.setViewportSize({ width: 390, height: 900 });
    const nav = page.getByRole("navigation", { name: "快捷导航" });
    for (const [label, path] of [
      ["笔记", "/records"],
      ["文献", "/library"],
      ["复习", "/review"],
      ["知识网", "/graph"],
    ]) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await expect(
      page.getByText("手机端仅供查看，建立和确认连线请使用电脑。"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /^(手动连线|AI 建议连线|确认连线|拒绝连线)$/,
      }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /文献 · / }).click();
    await expect(page.getByRole("link", { name: "打开文献" })).toHaveAttribute(
      "href",
      `/read/${resource}`,
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "手动连线", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "手动连线" })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "手动连线", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "打开导航" }).click();
    const dialog = page.getByRole("dialog", { name: "导航" });
    await expect(
      dialog.getByRole("combobox", { name: "工作区" }),
    ).toContainText("个人工作区");
    await expect(
      dialog.getByRole("combobox", { name: "空间", exact: true }),
    ).toContainText("私人空间");
  });
});
