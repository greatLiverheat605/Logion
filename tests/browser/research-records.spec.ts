import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("online records", () => {
  let context: BrowserContext,
    page: Page,
    scope: string,
    origin: string,
    csrf: string,
    noteId: string;
  const title = "原有笔记：模型假设与实验";
  test.beforeAll(async ({ browser, baseURL }) => {
    origin = baseURL!;
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    page = await context.newPage();
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: origin },
      data: {
        email: `records-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic records",
      },
    });
    expect(registered.status()).toBe(201);
    const workspace = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
    csrf = (await context.cookies()).find(
      (c) => c.name === "logion_csrf",
    )!.value;
    noteId = randomUUID();
    const legacy = await context.request.post(`${scope}/notes`, {
      headers: { Origin: origin, "X-CSRF-Token": csrf },
      data: { id: noteId, title, markdown_body: "原有正文。" },
    });
    expect(legacy.status()).toBe(201);
  });
  test.afterAll(async () => {
    await context?.close();
  });
  const open = async (tab: Page) => {
    await tab.goto("/records");
    await tab.getByRole("button", { name: new RegExp(title) }).click();
    await expect(
      tab.getByRole("textbox", { name: "笔记正文", exact: true }),
    ).toBeVisible();
  };
  const stored = async () =>
    (
      await (
        await context.request.get(`${scope}/research/notes/${noteId}`)
      ).json()
    ).markdown_body as string;

  test("old notes open online with one summary request; two tabs merge without resetting Yjs", async () => {
    let lists = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        request.url().endsWith("/research/notes")
      )
        lists++;
    });
    await open(page);
    expect(lists).toBe(1);
    await expect(
      page.getByRole("textbox", { name: "笔记正文", exact: true }),
    ).toHaveValue("原有正文。");
    const other = await context.newPage();
    await open(other);
    await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill("原有正文。左侧补充。");
    await expect.poll(stored).toBe("原有正文。左侧补充。");
    const beforeRename = await (
      await context.request.get(`${scope}/research/notes/${noteId}`)
    ).json();
    expect(
      (
        await context.request.patch(`${scope}/research/notes/${noteId}`, {
          headers: { Origin: origin, "X-CSRF-Token": csrf },
          data: {
            expected_version: beforeRename.version,
            title: "另一客户端修改的标题",
          },
        })
      ).status(),
    ).toBe(200);
    await other
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill("原有正文。右侧补充。");
    await expect.poll(stored).toContain("右侧补充。");
    expect(await stored()).toContain("左侧补充。");
    const result = await (
      await context.request.get(`${scope}/research/notes/${noteId}`)
    ).json();
    expect(result.yjs_generation).toBe(1);
    await expect(other.getByLabel("笔记标题", { exact: true })).toHaveValue(
      "另一客户端修改的标题",
    );
    await expect(
      other.getByRole("status").filter({ hasText: "正文已保存" }),
    ).toBeVisible();
    await other.close();
    await page
      .getByRole("button", { name: "载入最新版本", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "笔记正文", exact: true }),
    ).toHaveValue(await stored());
  });

  test("typing while a real save is in flight remains pending and is saved next", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let received!: () => void;
    const started = new Promise<void>((resolve) => {
      received = resolve;
    });
    await page.route(
      `**/research/notes/${noteId}/document`,
      async (route) => {
        const response = await route.fetch();
        received();
        await blocked;
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    const body = await stored();
    await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill(`${body}保存中的第一段。`);
    await started;
    await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill(`${body}保存中的第一段。继续输入第二段。`);
    release();
    await expect.poll(stored).toBe(`${body}保存中的第一段。继续输入第二段。`);
    await expect(
      page.getByRole("status").filter({ hasText: "正文已保存" }),
    ).toBeVisible();
  });

  test("offline edits are retained, require explicit retry and protect navigation", async () => {
    const body = await stored();
    await context.setOffline(true);
    await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill(`${body}离线保留的输入。`);
    await expect(
      page.getByRole("button", { name: "重试保存正文" }),
    ).toBeVisible();
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .getByRole("navigation", { name: "研究导航", exact: true })
      .getByRole("link", { name: "文献库", exact: true })
      .click();
    await expect(page).toHaveURL(/\/records$/);
    await expect(
      page.getByRole("textbox", { name: "笔记正文", exact: true }),
    ).toHaveValue(`${body}离线保留的输入。`);
    await context.setOffline(false);
    await page.getByRole("button", { name: "重试保存正文" }).click();
    await expect.poll(stored).toBe(`${body}离线保留的输入。`);
    await expect(
      page.getByRole("status").filter({ hasText: "正文已保存" }),
    ).toBeVisible();
    await page.getByLabel("笔记标题", { exact: true }).fill("未保存的标题");
    await page.getByRole("button", { name: "打开指令面板" }).click();
    await page.getByLabel("搜索指令", { exact: true }).fill("前往文献库");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("option", { name: "前往文献库" }).click();
    await expect(page).toHaveURL(/\/records$/);
    await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
      "未保存的标题",
    );
    await page
      .getByLabel("笔记标题", { exact: true })
      .fill("另一客户端修改的标题");
  });

  test("create, rename and reload notes with keyboard and eight responsive views", async ({}, testInfo) => {
    await page.getByLabel("新笔记标题").fill("新的研究笔记");
    await page.getByRole("button", { name: "新建笔记", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "新的研究笔记", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "笔记正文", exact: true })
      .fill(
        "动机：解释模型适用范围。\n实验：检验可复现的证据。\n疑问：样本偏差会如何影响结论？",
      );
    await page
      .getByLabel("笔记标题", { exact: true })
      .fill("模型适用范围与实验复核");
    await page.getByRole("button", { name: "保存标题" }).click();
    await expect(
      page.getByRole("heading", {
        name: "模型适用范围与实验复核",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "正文已保存" }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /模型适用范围与实验复核/ }).click();
    await expect(
      page.getByRole("textbox", { name: "笔记正文", exact: true }),
    ).toContainText("动机：解释模型适用范围。");
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
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
        await page.screenshot({
          path: testInfo.outputPath(`records-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });
});
