import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("private research questions", () => {
  let context: BrowserContext, page: Page, scope: string;
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
        email: `questions-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic knowledge review",
      },
    });
    expect(response.status()).toBe(201);
    const workspace = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("create, split, group and edit questions while keeping private ideas separate", async () => {
    await page.goto("/questions");
    const create = page.getByRole("button", { name: "新建问题", exact: true });
    await create.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: "问题", exact: true })
      .fill("染色质结构如何影响转录？");
    await dialog.getByLabel("研究缘由").fill("保留最初的研究动机和证据。 ");
    await dialog.getByRole("button", { name: "保存问题" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "拆分问题", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("子问题（每行一个，2–20 个）")
      .fill("如何建立 Hi-C 模型？\n如何验证实验结果？");
    await dialog.getByRole("button", { name: "确认拆分" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("region", { name: "问题树" })).toContainText(
      "如何验证实验结果？",
    );
    await page.getByRole("button", { name: "合并问题", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("共同的上级问题").fill("建立可靠的验证方法");
    await dialog.getByLabel("如何建立 Hi-C 模型？", { exact: true }).check();
    await dialog.getByLabel("如何验证实验结果？", { exact: true }).check();
    await dialog.getByRole("button", { name: "确认合并" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "编辑问题", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "状态", exact: true })
      .selectOption("answered");
    await dialog.getByRole("button", { name: "保存问题" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "问题详情" }),
    ).toContainText("已回答");
    const questions = (
      await (
        await context.request.get(`${scope}/research/question-tree`)
      ).json()
    ).questions as {
      id: string;
      parent_id: string | null;
      question: string;
      rationale: string;
      status: string;
    }[];
    const root = questions.find((q) => q.question === "建立可靠的验证方法")!;
    expect(questions.filter((q) => q.parent_id === root.id)).toHaveLength(2);
    expect(
      questions.find((q) => q.question === "染色质结构如何影响转录？")
        ?.rationale,
    ).toBe("保留最初的研究动机和证据。");
    await page.getByRole("radio", { name: "私人想法", exact: true }).click();
    await expect(
      page.getByText("仅自己可见，AI 不可读", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新建想法" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("标题", { exact: true }).fill("尚未发表的假设");
    await dialog
      .getByLabel("想法正文")
      .fill("PRIVATE_QUESTION_IDEA_SENTINEL_不得发送给AI");
    await dialog.getByRole("button", { name: "保存想法" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("complementary", { name: "想法详情" }),
    ).toContainText("PRIVATE_QUESTION_IDEA_SENTINEL");
    await page.reload();
    await page.getByRole("radio", { name: "私人想法", exact: true }).click();
    await page.getByRole("button", { name: /^尚未发表的假设/ }).click();
    await expect(
      page.getByRole("complementary", { name: "想法详情" }),
    ).toContainText("PRIVATE_QUESTION_IDEA_SENTINEL");
  });

  for (const view of ["问题树", "私人想法"]) {
    test(`${view} supports four widths and both themes`, async ({}, testInfo) => {
      await page.getByRole("radio", { name: view, exact: true }).click();
      await page
        .getByRole("button", {
          name: view === "问题树" ? /^建立可靠的验证方法/ : /^尚未发表的假设/,
        })
        .click();
      for (const width of [320, 390, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
            [],
          );
          const overflow = await page.evaluate(() =>
            [
              ...document.querySelectorAll<HTMLElement>(
                ".wb-page,.wb-inspector,.wb-question-tree,.wb-research-actions,.wb-library-row",
              ),
            ]
              .filter(
                (element) =>
                  element.clientWidth &&
                  element.scrollWidth > element.clientWidth + 1,
              )
              .map((element) => element.className),
          );
          expect(overflow).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(
              `${view === "问题树" ? "questions" : "ideas"}-${width}-${theme}.png`,
            ),
            fullPage: true,
          });
        }
      }
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
      expect(
        await page.evaluate(
          async () => (await navigator.serviceWorker.getRegistrations()).length,
        ),
      ).toBe(0);
    });
  }

  async function generate() {
    await page
      .getByRole("button", { name: "AI 建议连线", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).not.toContainText("尚未发表的假设");
    for (const title of [
      "研究问题 · 染色质结构如何影响转录？",
      "文献 · 环挤出实验",
      "文献 · 边界检验",
    ])
      await dialog.getByLabel(title, { exact: true }).check();
    await dialog
      .getByLabel("我确认将以上所选内容发送给已配置的 AI 服务商")
      .check();
    await dialog.getByRole("button", { name: "生成连线建议" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("建议已处理");
  }

  test("AI links need owner decisions and rejected links never return; ideas stay manual", async ({
    baseURL,
  }) => {
    const headers = {
      Origin: baseURL!,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
    for (const title of ["环挤出实验", "边界检验"]) {
      expect(
        (
          await context.request.post(`${scope}/library/resources`, {
            headers,
            data: { title },
          })
        ).status(),
      ).toBe(201);
    }
    const workspace = scope.split("/")[4],
      ai = `/api/v1/workspaces/${workspace}/ai`,
      provider = randomUUID();
    expect(
      (
        await context.request.post(`${ai}/providers`, {
          headers,
          data: {
            id: provider,
            name: "Synthetic network provider",
            provider_type: "openai_compatible",
            base_url: "https://api.example.com/v1",
            credential: "synthetic-network",
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
          `${ai}/providers/${provider}/discover-models`,
          { headers },
        )
      ).status(),
    ).toBe(200);
    const model = (await (await context.request.get(`${ai}/models`)).json())
      .models[0];
    expect(
      (
        await context.request.put(`${ai}/models/${model.id}`, {
          headers,
          data: {
            expected_version: model.version,
            display_name: "Synthetic network",
            enabled: true,
            supports_json: true,
            supports_stream: false,
            context_window: 32000,
            pricing_currency: "USD",
            input_cost_per_million_minor: 1,
            output_cost_per_million_minor: 1,
          },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await context.request.post(
          `/api/v1/workspaces/${workspace}/research/ai/presets`,
          {
            headers,
            data: {
              economical_model_ids: [model.id],
              quality_model_ids: [model.id],
            },
          },
        )
      ).status(),
    ).toBe(201);
    await page.goto("/graph");
    await page.setViewportSize({ width: 1440, height: 900 });
    await generate();
    const first = page.getByRole("button", {
      name: /^环挤出实验 → 回应 →.*AI 建议$/,
    });
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("complementary", { name: "知识网详情" }),
    ).toContainText("Synthetic evidence");
    await page.getByRole("button", { name: "确认连线", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^环挤出实验 → 回应 →.*已确认$/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^边界检验 → 回应 →.*AI 建议$/ })
      .click();
    await page.getByRole("button", { name: "拒绝连线", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^边界检验 → 回应/ }),
    ).toHaveCount(0);
  });

  test("rejected suggestions stay absent and private ideas can be linked manually", async () => {
    await generate();
    const edges = (
      await (
        await context.request.get(`${scope}/research/knowledge/edges`)
      ).json()
    ).edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].status).toBe("confirmed");
    await page.getByRole("button", { name: "手动连线", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "起点", exact: true })
      .selectOption({ label: "私人想法 · 尚未发表的假设" });
    await dialog
      .getByRole("combobox", { name: "终点", exact: true })
      .selectOption({ label: "文献 · 环挤出实验" });
    await dialog
      .getByLabel("理由（可选）")
      .fill("本人把想法和阅读证据联系起来。");
    await dialog.getByRole("button", { name: "保存连线" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^尚未发表的假设 → 启发于/ }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^尚未发表的假设 → 启发于/ }),
    ).toBeVisible();
    await page
      .getByLabel("聚焦研究问题", { exact: true })
      .selectOption({ label: "染色质结构如何影响转录？" });
    await expect(
      page.getByRole("button", { name: "文献：边界检验", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: /^尚未发表的假设 → 启发于/ })
      .click();
  });

  test("network is usable at four widths in both themes", async ({}, testInfo) => {
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
        expect(
          await page
            .locator(".wb-network,.wb-network-view,.wb-inspector")
            .evaluateAll((elements) =>
              elements
                .filter(
                  (el) => el.clientWidth && el.scrollWidth > el.clientWidth + 1,
                )
                .map((el) => el.className),
            ),
        ).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`network-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  });

  test("200 nodes and 400 edges remain responsive without a simulation", async () => {
    const nodes = Array.from({ length: 200 }, (_, i) => ({
      id: randomUUID(),
      kind: "resource",
      title: `规模节点 ${i}`,
      version: 1,
      personal: true,
    }));
    const edges = Array.from({ length: 400 }, (_, i) => ({
      id: randomUUID(),
      from_type: "resource",
      from_id: nodes[i % 200].id,
      to_type: "resource",
      to_id: nodes[(i + 1 + Math.floor(i / 200)) % 200].id,
      relation: "extends",
      reason: "Synthetic bounded performance relation",
      status: "suggested",
      origin: "ai",
      version: 1,
      ai_run_id: randomUUID(),
      evidence_excerpt_id: null,
      created_at: new Date().toISOString(),
      decided_at: null,
    }));
    await page.route("**/research/knowledge/graph*", (route) =>
      route.fulfill({
        json: { nodes, edges, prerequisites: [], truncated: false },
      }),
    );
    await page.goto("/graph");
    await expect(page.locator(".wb-network-node")).toHaveCount(200);
    await expect(page.locator(".wb-network-edge")).toHaveCount(400);
    const start = performance.now();
    await page
      .getByRole("button", { name: "文献：规模节点 0", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("complementary", { name: "知识网详情" }),
    ).toContainText("规模节点 0");
    await page.getByRole("button", { name: "放大", exact: true }).click();
    await expect(page.locator(".wb-network-canvas svg")).toHaveAttribute(
      "width",
      "1250",
    );
    expect(performance.now() - start).toBeLessThan(2000);
    await page.unroute("**/research/knowledge/graph*");
  });

  test("weekly plan creates explicit goals and preserves owner completion", async () => {
    await page.goto("/plan");
    await page.getByRole("button", { name: "新建目标", exact: true }).focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("目标名称").fill("理解环挤出实验");
    await dialog.getByLabel("期望成果").fill("形成一份可检验的证据总结");
    await dialog.getByLabel("首个阶段").fill("阅读与自测");
    await dialog.getByLabel("阶段验收标准").fill("解释关键假设和实验边界");
    await dialog.getByRole("button", { name: "保存目标" }).click();
    await expect(dialog).toHaveCount(0);
    for (const title of [
      "顺延阅读任务",
      "降级阅读任务",
      "放弃阅读任务",
      "整理本周问题",
    ]) {
      await page
        .getByRole("button", { name: "添加阅读计划", exact: true })
        .click();
      dialog = page.getByRole("dialog");
      await dialog.getByLabel("阅读任务", { exact: true }).fill(title);
      await dialog
        .getByRole("combobox", { name: "关联目标", exact: true })
        .selectOption({ label: "理解环挤出实验" });
      if (title !== "整理本周问题") {
        await dialog
          .getByRole("combobox", { name: "文献（可选）", exact: true })
          .selectOption({ label: "环挤出实验" });
      }
      await dialog.getByRole("button", { name: "保存阅读计划" }).click();
      await expect(dialog).toHaveCount(0);
    }
    const item = page
      .locator(".wb-weekly-task-list > li")
      .filter({ hasText: "整理本周问题" });
    await item.getByRole("button", { name: "本人确认完成" }).click();
    await expect(item).toContainText("已完成");
    await page.getByRole("button", { name: "开始周回顾" }).click();
    await expect(page.getByRole("region", { name: "周回顾" })).toContainText(
      "未完成项 · 3",
    );
    await expect(
      page.getByRole("button", { name: "确认周回顾并生成下周计划" }),
    ).toBeDisabled();
  });

  test("weekly AI receives statistics, stays a draft, and survives reload", async () => {
    await page.getByLabel("允许发送统计数字").check();
    await page.getByRole("button", { name: "请求 AI 点评草稿" }).click();
    const draft = page.getByRole("region", { name: "AI 周回顾草稿" }).first();
    await expect(draft).toContainText("本周阅读节奏清晰");
    await expect(
      page.getByRole("heading", { name: "已接受的 AI 点评" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(draft).toContainText("本周阅读节奏清晰");
    await draft.getByRole("button", { name: "接受点评" }).click();
    await expect(
      page.getByRole("heading", { name: "已接受的 AI 点评" }),
    ).toBeVisible();
    for (const [title, action] of [
      ["顺延阅读任务", "carry"],
      ["降级阅读任务", "downgrade"],
      ["放弃阅读任务", "drop"],
    ]) {
      const item = page.getByRole("group", { name: title, exact: true });
      await item
        .getByRole("combobox", { name: "处理方式", exact: true })
        .selectOption(action);
      await item
        .getByLabel("原因（可选，仅自己可见）")
        .fill("私人调整原因，不发送给 AI。");
    }
    await expect(
      page.getByRole("button", { name: "确认周回顾并生成下周计划" }),
    ).toBeEnabled();
  });

  test("weekly plan and review support four widths, themes and keyboard", async ({}, testInfo) => {
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
        expect(
          await page
            .locator(".wb-weekly-tasks,.wb-weekly-review,.wb-weekly-triage")
            .evaluateAll((elements) =>
              elements
                .filter(
                  (el) => el.clientWidth && el.scrollWidth > el.clientWidth + 1,
                )
                .map((el) => el.className),
            ),
        ).toEqual([]);
        await page.locator(".wb-main").evaluate((element) => {
          element.scrollTop = 0;
        });
        await page.screenshot({
          path: testInfo.outputPath(`weekly-${width}-${theme}.png`),
          fullPage: true,
        });
        await page
          .getByRole("heading", { name: "周回顾", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`weekly-review-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
  });

  test("owner review confirmation creates next-week tasks once", async () => {
    const confirm = page.getByRole("button", {
      name: "确认周回顾并生成下周计划",
    });
    await confirm.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "本周回顾已确认" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("status").filter({ hasText: "本周回顾已确认" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "添加阅读计划", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "查看下周计划" }).click();
    const tasks = page.locator(".wb-weekly-task-list > li");
    await expect(tasks).toHaveCount(2);
    await expect(tasks.filter({ hasText: "降级阅读任务" })).toContainText(
      "略读",
    );
    await expect(tasks.filter({ hasText: "顺延阅读任务" })).toContainText(
      "精读",
    );
    await page.reload();
    await page.getByRole("button", { name: "查看下周计划" }).click();
    await expect(tasks).toHaveCount(2);
  });
});
