import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function selectPassage(page: Page) {
  const layer = page.locator(
    '[data-pdf-page="1"] [data-reader-text-layer="true"]',
  );
  await expect(layer).toContainText("careful reading");
  await layer.evaluate((element) => {
    const span = [...element.querySelectorAll("span[data-text-start]")].find(
      (node) => node.textContent?.includes("careful reading"),
    )!;
    (element.closest(".wb-pane-content") as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

// These stages share one real paper and session; every stage retains the existing timeout.
test.describe.serial("one paper reading loop", () => {
  let context: BrowserContext, page: Page, scope: string, resourceId: string;
  let headers: Record<string, string>;
  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    page = await context.newPage();
    const response = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL! },
      data: {
        email: `loop-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic reading loop",
      },
    });
    expect(response.status()).toBe(201);
    headers = {
      Origin: baseURL!,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
    const workspace = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
    const ai = `/api/v1/workspaces/${workspace}/ai`,
      providerId = randomUUID();
    expect(
      (
        await context.request.post(`${ai}/providers`, {
          headers,
          data: {
            id: providerId,
            name: "Synthetic loop provider",
            provider_type: "openai_compatible",
            base_url: "https://api.example.com/v1",
            credential: "synthetic-provider",
            enabled: true,
            timeout_seconds: 30,
            max_retries: 0,
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await context.request.post(
          `${ai}/providers/${providerId}/discover-models`,
          { headers },
        )
      ).status(),
    ).toBe(200);
    const discovered = (
      await (await context.request.get(`${ai}/models`)).json()
    ).models as { id: string; provider_model_id: string; version: number }[];
    const models: string[] = [];
    for (const tier of ["economical", "quality"]) {
      const selected = discovered.find(
        (m) => m.provider_model_id === `synthetic-${tier}`,
      )!;
      const result = await context.request.put(`${ai}/models/${selected.id}`, {
        headers,
        data: {
          expected_version: selected.version,
          display_name: tier,
          enabled: true,
          supports_json: true,
          supports_stream: false,
          context_window: 32000,
          pricing_currency: "USD",
          input_cost_per_million_minor: 1,
          output_cost_per_million_minor: 1,
        },
      });
      expect(result.status()).toBe(200);
      models.push((await result.json()).id);
    }
    expect(
      (
        await context.request.post(
          `/api/v1/workspaces/${workspace}/research/ai/presets`,
          {
            headers,
            data: {
              economical_model_ids: [models[0]],
              quality_model_ids: [models[1]],
            },
          },
        )
      ).status(),
    ).toBe(201);
    expect(
      (
        await context.request.post(`${scope}/research/ideas`, {
          headers,
          data: {
            title: "Private idea",
            body: "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND",
          },
        })
      ).status(),
    ).toBe(201);
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("configure credentials, synchronize and excerpt a PDF", async () => {
    await page.goto("/settings");
    const zotero = page.getByRole("region", { name: "Zotero 集成" });
    await zotero.getByRole("button", { name: "配置 Zotero" }).click();
    await zotero.getByLabel("只读 API Key").fill("synthetic-zotero");
    await zotero.getByRole("button", { name: "保存凭据" }).click();
    await zotero.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(zotero.getByRole("status")).toHaveText("已连接");
    const dav = page.getByRole("region", { name: "坚果云 集成" });
    await dav.getByRole("button", { name: "配置 坚果云" }).click();
    await dav.getByLabel("坚果云账号").fill("synthetic-account");
    await dav.getByLabel("应用密码").fill("synthetic-webdav");
    await dav.getByRole("button", { name: "保存凭据" }).click();
    await dav.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(dav.getByRole("status")).toHaveText("已连接");
    const sync = page.getByRole("region", { name: "Zotero 文献同步" });
    await sync.getByRole("button", { name: "立即同步 Zotero" }).click();
    await expect(sync.getByRole("status")).toContainText("最近同步：");
    await page.goto("/library");
    await page
      .getByRole("button", { name: /Synthetic synchronized paper/ })
      .click();
    const ready = page.waitForResponse(
      (r) => r.url().endsWith("/text") && r.request().method() === "POST",
    );
    await page.getByRole("link", { name: "进入阅读" }).click();
    expect((await ready).status()).toBe(200);
    resourceId = page.url().split("/read/")[1]!;
    await page.getByRole("button", { name: "知道了" }).click();
    await page.getByRole("button", { name: "开始阅读", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "阅读状态：在读" }),
    ).toBeVisible();
    await selectPassage(page);
    await page.keyboard.press("h");
    await expect(
      page.getByRole("status").filter({ hasText: "摘录已保存" }),
    ).toBeVisible();
    const excerpts = (
      await (
        await context.request.get(
          `${scope}/library/resources/${resourceId}/excerpts`,
        )
      ).json()
    ).excerpts;
    expect(excerpts.map((e: { origin: string }) => e.origin).sort()).toEqual([
      "logion",
      "zotero",
    ]);
  });

  test("translate, explain and accept a close-reading note draft", async () => {
    await selectPassage(page);
    await page.keyboard.press("t");
    await expect(
      page.getByRole("region", { name: "AI 阅读草稿" }),
    ).toContainText("Synthetic translated passage");
    await selectPassage(page);
    await page.keyboard.press("e");
    await expect(
      page.getByRole("region", { name: "AI 阅读草稿" }),
    ).toContainText("Synthetic explanation");
    await page.getByRole("button", { name: "选择右栏内容" }).click();
    await page.getByRole("menuitem", { name: "精读笔记" }).click();
    await page.getByRole("button", { name: "创建精读笔记" }).click();
    const editor = page.getByRole("textbox", { name: "精读笔记正文" });
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/note/document") && r.request().method() === "PATCH",
    );
    await editor.fill(
      (await editor.inputValue()).replace(
        "## 动机\n",
        "## 动机\nMy evidence from this paper.\n",
      ),
    );
    expect((await saved).status()).toBe(200);
    await page.getByRole("button", { name: "发送原文并起草缺失章节" }).click();
    await expect(
      page.getByRole("heading", { name: "待确认草稿" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "接受并写入笔记" }).click();
    await expect(editor).toHaveValue(/My evidence from this paper/);
    await expect(editor).toHaveValue(/Synthetic explanation/);
  });

  test("accept questions, answer on a phone and confirm mastery", async () => {
    await page.getByRole("button", { name: "选择右栏内容" }).click();
    await page.getByRole("menuitem", { name: "自测", exact: true }).click();
    await page.getByRole("button", { name: "发送原文并起草 5 道题" }).click();
    await expect(
      page.getByRole("region", { name: "测验题目草稿" }).getByRole("listitem"),
    ).toHaveCount(5);
    const quizPath = `${scope}/library/resources/${resourceId}/quiz`;
    expect((await (await context.request.get(quizPath)).json()).items).toEqual(
      [],
    );
    await page.getByRole("button", { name: "接受题目", exact: true }).click();
    await expect(page.getByLabel("选择题目").getByRole("option")).toHaveCount(
      5,
    );
    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("radio", { name: "右 · 自测" }).click();
    const response = page.getByRole("textbox", { name: "我的作答" });
    await response.fill(
      "The paper motivates careful reading and experimental checks.",
    );
    await context.setOffline(true);
    await page.getByRole("button", { name: "提交作答并请求批改" }).click();
    await expect(
      page.locator(".wb-reading-quiz").getByRole("alert").first(),
    ).toContainText("需要联网");
    await context.setOffline(false);
    await expect(response).toHaveValue(/careful reading/);
    await page.getByRole("button", { name: "提交作答并请求批改" }).click();
    await expect(
      page.getByRole("heading", { name: "AI 批改证据 · 80 / 100" }),
    ).toBeVisible();
    let quiz = (await (await context.request.get(quizPath)).json()).items;
    expect(quiz[0].mastery).toBeNull();
    expect(quiz[0].review_schedule).toBeNull();
    expect(quiz[0].answer_key).toBeUndefined();
    await page.getByRole("button", { name: "查看参考答案" }).click();
    await expect(page.getByRole("region", { name: "参考答案" })).toContainText(
      "Synthetic reference 1",
    );
    await page.getByLabel("我的判断").selectOption("mastered");
    await page.getByRole("button", { name: "确认并安排复习" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已确认：已掌握" }),
    ).toBeVisible();
    quiz = (await (await context.request.get(quizPath)).json()).items;
    expect(quiz[0].mastery.confirmed_level).toBe("mastered");
    expect(quiz[0].review_schedule.interval_days).toBe(14);
  });

  test("review evidence is usable in both themes at four widths", async ({}, testInfo) => {
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (width < 768)
          await page.getByRole("radio", { name: "右 · 自测" }).click();
        await page
          .getByRole("heading", { name: "理解测验" })
          .scrollIntoViewIfNeeded();
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`quiz-${width}-${theme}.png`),
        });
      }
    }
    await page.goto("/review");
    await expect(
      page.getByRole("heading", { name: "Reading concept 1" }),
    ).toBeVisible();
    for (const width of [1440, 390]) {
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
          path: testInfo.outputPath(`review-${width}-${theme}.png`),
        });
      }
    }
    await page.getByLabel("只看已到期").check();
    await expect(
      page.getByText("暂无到期阅读复习。", { exact: false }),
    ).toBeVisible();
    await page.getByLabel("只看已到期").uncheck();
    await expect(
      page.getByRole("heading", { name: "Reading concept 1" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "回到原文作答" }).click();
    await expect(page.getByRole("textbox", { name: "我的作答" })).toBeVisible();
    await page.getByLabel("我的判断").selectOption("practicing");
    await page.getByRole("button", { name: "确认并安排复习" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "已确认：仍需练习" }),
    ).toBeVisible();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });

  test("Today resumes active reading in both themes at four widths", async ({}, testInfo) => {
    await page.goto("/today");
    const resume = page.getByRole("link", {
      name: "继续阅读：Synthetic synchronized paper",
    });
    await expect(resume).toBeVisible();
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
          path: testInfo.outputPath(`today-${width}-${theme}.png`),
        });
      }
    }
    await resume.click();
    await expect(
      page.getByRole("status").filter({ hasText: "阅读状态：在读" }),
    ).toBeVisible();
  });

  test("owner completion persists while offline changes are refused", async () => {
    await context.setOffline(true);
    await page.getByRole("button", { name: "标记精读完成" }).click();
    await expect(
      page.locator(".wb-reading-progress").getByRole("alert"),
    ).toContainText("需要联网");
    await expect(
      page.getByRole("status").filter({ hasText: "阅读状态：在读" }),
    ).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: "标记精读完成" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "阅读状态：精读完成" }),
    ).toBeVisible();
    const resource = await (
      await context.request.get(`${scope}/library/resources/${resourceId}`)
    ).json();
    expect(resource.reading_status).toBe("close_read");
    expect(Number.isFinite(Date.parse(resource.read_at))).toBe(true);
    await page.goto("/library");
    await page
      .getByRole("combobox", { name: "阅读状态", exact: true })
      .selectOption("close_read");
    await expect(
      page.getByRole("button", { name: /Synthetic synchronized paper/ }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "阅读状态", exact: true })
      .selectOption("reading");
    await expect(
      page.getByRole("button", { name: /Synthetic synchronized paper/ }),
    ).toHaveCount(0);
    await page.goto("/today");
    await expect(
      page.getByText("还没有在读文献。", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "继续阅读：Synthetic synchronized paper",
      }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });
});
