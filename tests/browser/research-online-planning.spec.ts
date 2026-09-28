import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("online today and planning", () => {
  let context: BrowserContext,
    page: Page,
    scope: string,
    csrf: string,
    origin: string;
  let goalId: string, dueDay: string;
  test.beforeAll(async ({ browser, baseURL }) => {
    origin = baseURL!;
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
    });
    page = await context.newPage();
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: origin },
      data: {
        email: `online-planning-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic online planning",
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
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("create and edit goal details, reorder, archive and restore phases", async () => {
    await page.goto("/plan");
    await page.getByRole("button", { name: "新建目标", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("目标名称").fill("读懂染色质建模方法");
    await dialog
      .getByLabel("期望成果")
      .fill("用自己的话解释模型假设、实验与限制。");
    await dialog.getByLabel("目标说明").fill("保留已有阅读计划与任务引用。");
    await dialog.getByLabel("每周投入（分钟）").fill("180");
    await dialog.getByLabel("目标日期（可留空）").fill("2027-01-01");
    await dialog.getByLabel("首个阶段").fill("梳理动机");
    await dialog
      .getByLabel("阶段验收标准", { exact: true })
      .fill("独立说明研究问题");
    await dialog.getByRole("button", { name: "保存目标" }).click();
    await expect(dialog).toHaveCount(0);
    const section = page.getByRole("region", { name: "目标与阶段" });
    await section
      .locator("summary")
      .filter({ hasText: "读懂染色质建模方法" })
      .click();
    await section.getByRole("button", { name: "编辑目标" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("目标名称").fill("读懂染色质建模方法与验证");
    await dialog.getByLabel("目标日期（可留空）").fill("");
    await dialog.getByLabel("每周投入（分钟）").fill("210");
    await dialog.getByRole("button", { name: "保存目标" }).click();
    await expect(dialog).toHaveCount(0);
    await section.getByRole("button", { name: "编辑阶段" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "添加阶段" }).click();
    const second = dialog.getByRole("group", { name: "阶段 2", exact: true });
    await second.getByLabel("阶段名称").fill("检验模型与实验");
    await second
      .getByLabel("验收标准（每行一条，最多 50 条）")
      .fill("解释评估指标\n识别一项实验限制");
    await second.getByRole("button", { name: "上移" }).focus();
    await page.keyboard.press("Enter");
    await dialog
      .getByRole("group", { name: "阶段 2", exact: true })
      .getByRole("button", { name: "归档阶段" })
      .click();
    await dialog.getByRole("button", { name: "保存阶段" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      section.getByText("检验模型与实验", { exact: false }).first(),
    ).toBeVisible();
    await section.getByRole("button", { name: "编辑阶段" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "恢复阶段" }).click();
    await dialog.getByRole("button", { name: "保存阶段" }).click();
    await expect(dialog).toHaveCount(0);
    await section.getByRole("button", { name: "启用计划" }).click();
    await expect(section).toContainText("进行中");
    const goals = (
      await (await context.request.get(`${scope}/research/goals`)).json()
    ).goals;
    expect(goals).toHaveLength(1);
    goalId = goals[0].goal_id;
    expect(goals[0]).toMatchObject({
      title: "读懂染色质建模方法与验证",
      weekly_minutes: 210,
      target_date: null,
      description: "保留已有阅读计划与任务引用。",
    });
    expect(goals[0].phases.map((p: { title: string }) => p.title)).toEqual([
      "检验模型与实验",
      "梳理动机",
    ]);
    expect(
      goals[0].phases.every(
        (p: { archived_at: string | null }) => p.archived_at === null,
      ),
    ).toBe(true);
  });

  test("stale goal edit keeps input until an explicit reload", async () => {
    await page.getByRole("button", { name: "编辑目标", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("目标名称").fill("尚未保存的本地输入");
    const current = (
      await (await context.request.get(`${scope}/research/goals`)).json()
    ).goals[0];
    const changed = await context.request.patch(
      `${scope}/research/goals/${goalId}`,
      {
        headers: { Origin: origin, "X-CSRF-Token": csrf },
        data: { expected_version: current.goal_version, weekly_minutes: 240 },
      },
    );
    expect(changed.status()).toBe(200);
    await dialog.getByRole("button", { name: "保存目标" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "内容已在其他页面更新",
    );
    await expect(dialog.getByLabel("目标名称")).toHaveValue(
      "尚未保存的本地输入",
    );
    await dialog
      .getByRole("button", { name: "放弃当前输入并载入最新版本" })
      .click();
    await expect(dialog.getByLabel("每周投入（分钟）")).toHaveValue("240");
    await expect(dialog.getByLabel("目标名称")).toHaveValue(
      "读懂染色质建模方法与验证",
    );
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  });

  test("phase editor supports narrow screens and discards an unsaved new phase", async ({}, testInfo) => {
    await page.getByRole("button", { name: "编辑阶段", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "添加阶段" }).click();
    await dialog.getByRole("button", { name: "阶段 3 的更多操作" }).click();
    await page.getByRole("menuitem", { name: "移除阶段" }).click();
    await expect(dialog.getByRole("group")).toHaveCount(2);
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`phase-editor-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    await dialog.getByRole("button", { name: "保存阶段" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("today uses the selected local day and fetches each initial projection once", async () => {
    const headers = { Origin: origin, "X-CSRF-Token": csrf };
    const topicId = randomUUID();
    const topic = await context.request.post(`${scope}/topics`, {
      headers,
      data: {
        id: topicId,
        title: "已有知识点的到期复习",
        description: "保留原来的复习规则",
      },
    });
    expect(topic.status()).toBe(201);
    const confirmation = await context.request.put(
      `${scope}/topics/${topicId}/mastery/confirmation`,
      {
        headers,
        data: {
          mastery_id: randomUUID(),
          schedule_id: randomUUID(),
          expected_version: 0,
          confirmed_level: "unknown",
        },
      },
    );
    expect(confirmation.status()).toBe(200);
    dueDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(
      new Date((await confirmation.json()).review_schedule.next_review_at),
    );
    const readingTask = await context.request.post(
      `${scope}/research/weekly/tasks`,
      {
        headers,
        data: {
          goal_id: goalId,
          title: "所选日期的阅读计划",
          resource_id: null,
          scheduled_on: dueDay,
          reading_mode: "skim",
          estimated_minutes: 25,
        },
      },
    );
    expect(readingTask.status()).toBe(201);
    const calls: string[] = [];
    const observe = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "GET" &&
        [
          "/research/review-queue",
          "/research/weekly",
          "/library/resources",
        ].some((p) => new URL(request.url()).pathname.endsWith(p))
      )
        calls.push(new URL(request.url()).pathname);
    };
    page.on("request", observe);
    await page.goto("/today");
    await expect(
      page.getByRole("heading", { name: "继续阅读", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("所选日期暂无到期复习。")).toBeVisible();
    page.off("request", observe);
    expect(calls.filter((url) => url.endsWith("/review-queue"))).toHaveLength(
      1,
    );
    expect(calls.filter((url) => url.endsWith("/weekly"))).toHaveLength(1);
    expect(calls.filter((url) => url.endsWith("/resources"))).toHaveLength(1);
    await page.getByLabel("日期", { exact: true }).fill(dueDay);
    await expect(page.getByRole("region", { name: "到期复习" })).toContainText(
      "已有知识点的到期复习",
    );
    await expect(
      page.getByRole("region", { name: "今日阅读计划" }),
    ).toContainText("所选日期的阅读计划");
    await page.getByRole("button", { name: "前一天" }).click();
    await expect(
      page.getByRole("region", { name: "今日阅读计划" }),
    ).not.toContainText("所选日期的阅读计划");
    await page.getByRole("button", { name: "后一天" }).click();
    await expect(
      page.getByRole("region", { name: "今日阅读计划" }),
    ).toContainText("所选日期的阅读计划");
  });

  for (const route of ["today", "plan"]) {
    test(`${route} supports four widths, both themes and no offline storage`, async ({}, testInfo) => {
      await page.goto(`/${route}`);
      if (route === "today") {
        await page.getByLabel("日期", { exact: true }).fill(dueDay);
        await expect(
          page.getByRole("region", { name: "到期复习" }),
        ).toContainText("已有知识点的到期复习");
      } else {
        await page.locator(".wb-goal-list > li > details > summary").click();
      }
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
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          expect(
            await page
              .locator(
                ".wb-main,.wb-goal-list,.wb-weekly-tasks,.wb-weekly-review",
              )
              .evaluateAll((elements) =>
                elements
                  .filter(
                    (el) =>
                      el.clientWidth && el.scrollWidth > el.clientWidth + 1,
                  )
                  .map((el) => el.className),
              ),
          ).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath(`${route}-${width}-${theme}.png`),
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
});
