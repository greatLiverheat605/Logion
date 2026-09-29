import { createHash, randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("online unified review", () => {
  let context: BrowserContext,
    page: Page,
    scope: string,
    memory: string,
    origin: string,
    csrf: string;
  let topicId: string, quizId: string;
  const topicTitle = "原有知识点：实验可重复性";
  const excerpt = "可重复实验需要公开方法与数据。";
  const prompt = "两次独立实验各得到二，合计是多少？";
  const headers = () => ({ Origin: origin, "X-CSRF-Token": csrf });
  test.beforeAll(async ({ browser, baseURL }) => {
    origin = baseURL!;
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    page = await context.newPage();
    const registration = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: origin },
      data: {
        email: `memory-review-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic memory review",
      },
    });
    expect(registration.status()).toBe(201);
    const workspace = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
    memory = `${scope}/research/memory`;
    csrf = (await context.cookies()).find(
      (c) => c.name === "logion_csrf",
    )!.value;
    const noteId = randomUUID();
    topicId = randomUUID();
    quizId = randomUUID();
    const note = await context.request.post(`${scope}/notes`, {
      headers: headers(),
      data: {
        id: noteId,
        title: "原始实验笔记",
        markdown_body: "😀 后续补充。" + excerpt,
      },
    });
    expect(note.status()).toBe(201);
    expect(
      (
        await context.request.post(`${scope}/topics`, {
          headers: headers(),
          data: {
            id: topicId,
            title: topicTitle,
            description: "来源笔记：原始实验笔记\n\n" + excerpt,
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await context.request.post(`${scope}/quiz-items`, {
          headers: headers(),
          data: {
            id: quizId,
            topic_id: topicId,
            prompt,
            answer_key: "4",
            explanation: "两个二合为四。",
            evaluation_mode: "exact_match",
          },
        })
      ).status(),
    ).toBe(201);
    const device = (
      await (await context.request.get("/api/v1/auth/devices")).json()
    ).devices.find((d: { current: boolean }) => d.current).id;
    const envelope = {
      workspace_id: workspace,
      device_id: device,
      protocol_version: "sync-v1",
    };
    const bootstrap = await context.request.post(
      `/api/v1/workspaces/${workspace}/sync/bootstrap`,
      {
        headers: headers(),
        data: {
          ...envelope,
          message_type: "bootstrap_request",
          known_sync_epoch: null,
          snapshot_id: null,
          chunk_index: null,
        },
      },
    );
    expect(bootstrap.status()).toBe(200);
    const payload = {
      space_id: space,
      source_kind: "note",
      source_id: noteId,
      target_kind: "topic",
      target_id: topicId,
      excerpt_sha256: createHash("sha256").update(excerpt).digest("hex"),
      excerpt_start: 0,
      excerpt_end: excerpt.length,
      source_version: 1,
    };
    const source = await context.request.post(
      `/api/v1/workspaces/${workspace}/sync/push`,
      {
        headers: headers(),
        data: {
          ...envelope,
          sync_epoch: (await bootstrap.json()).sync_epoch,
          message_type: "push_request",
          operations: [
            {
              ...envelope,
              operation_id: randomUUID(),
              entity_type: "source_link",
              entity_id: randomUUID(),
              operation_type: "create",
              base_version: 0,
              client_occurred_at: new Date().toISOString(),
              payload,
              payload_hash: `sha256:${createHash("sha256")
                .update(JSON.stringify(payload, Object.keys(payload).sort()))
                .digest("hex")}`,
              dependencies: [],
            },
          ],
        },
      },
    );
    expect(source.status()).toBe(200);
    expect((await source.json()).results[0].status).toBe("applied");
  });
  test.afterAll(async () => {
    await context?.close();
  });
  const detail = () =>
    page.getByRole("region", { name: "知识点详情", exact: true });
  const recall = () =>
    detail()
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: prompt, exact: true }),
      });
  const stored = async () =>
    (await (await context.request.get(`${memory}/topics/${topicId}`)).json())
      .topic;

  test("legacy topic opens from Today query and source link locates the original note excerpt", async () => {
    let lists = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === `${memory}/topics`
      )
        lists++;
    });
    await page.goto(`/review?topic=${topicId}`);
    await expect(
      detail().getByRole("heading", { name: topicTitle, exact: true }),
    ).toBeVisible();
    await expect(recall().getByLabel("我的回答")).toBeVisible();
    expect(lists).toBe(1);
    await recall()
      .getByRole("link", { name: "打开原文：原始实验笔记" })
      .click();
    await expect(page).toHaveURL(/\/records\?note=/);
    const body = page.getByRole("textbox", { name: "笔记正文", exact: true });
    await expect(
      page.getByRole("status").filter({ hasText: "已定位原选段。" }),
    ).toBeVisible();
    expect(
      await body.evaluate((element: HTMLTextAreaElement) =>
        element.value.slice(element.selectionStart, element.selectionEnd),
      ),
    ).toBe(excerpt);
  });

  test("phone answers use legacy grading and only owner confirmation schedules mastery", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/review?topic=${topicId}`);
    await recall().getByLabel("我的回答").fill("3");
    await recall().getByRole("button", { name: "提交回答" }).click();
    await expect(
      recall().getByText("本次需要再练习", { exact: true }),
    ).toBeVisible();
    expect((await stored()).mastery).toBeNull();
    expect((await stored()).review_schedule.status).toBe("due");
    await recall().getByRole("button", { name: "再次作答" }).click();
    await recall().getByLabel("我的回答").fill("4");
    await recall().getByRole("button", { name: "提交回答" }).click();
    await expect(
      recall().getByText("本次回答正确", { exact: true }),
    ).toBeVisible();
    expect((await stored()).mastery).toBeNull();
    await detail()
      .getByRole("combobox", { name: "掌握程度", exact: true })
      .selectOption("familiar");
    await detail().getByRole("button", { name: "确认掌握并安排复习" }).click();
    await expect(
      detail().getByRole("status").filter({ hasText: "掌握程度已确认" }),
    ).toBeVisible();
    expect((await stored()).mastery.confirmed_level).toBe("familiar");
    expect((await stored()).review_schedule.interval_days).toBe(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

  test("offline answers retain input and require explicit submission after reconnect", async () => {
    await recall().getByRole("button", { name: "再次作答" }).click();
    await context.setOffline(true);
    await recall().getByLabel("我的回答").fill("4");
    await recall().getByRole("button", { name: "提交回答" }).click();
    await expect(recall().getByRole("alert")).toContainText("需要联网");
    page.once("dialog", (dialog) => dialog.dismiss());
    await recall()
      .getByRole("link", { name: "打开原文：原始实验笔记" })
      .click();
    await expect(page).toHaveURL(/\/review\?topic=/);
    await expect(recall().getByLabel("我的回答")).toHaveValue("4");
    await context.setOffline(false);
    await recall().getByRole("button", { name: "提交回答" }).click();
    await expect(
      recall().getByText("本次回答正确", { exact: true }),
    ).toBeVisible();
  });

  test("create self-assessed recall, preserve stale correction and retire without deleting history", async () => {
    await detail().getByRole("button", { name: "新建回忆题" }).click();
    let sheet = page.getByRole("dialog", { name: "新建回忆题", exact: true });
    await sheet
      .getByLabel("题目", { exact: true })
      .fill("说明可重复实验的条件。");
    await sheet
      .getByLabel("参考答案", { exact: true })
      .fill("公开方法与数据。");
    await sheet.getByRole("button", { name: "保存回忆题" }).click();
    const self = detail()
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", {
          name: "说明可重复实验的条件。",
          exact: true,
        }),
      });
    await self.getByLabel("我的回答").fill("公开方法与数据。");
    await self
      .getByRole("combobox", { name: "本人判断", exact: true })
      .selectOption("yes");
    await self.getByRole("button", { name: "提交回答" }).click();
    await expect(self.getByText("本次回答正确", { exact: true })).toBeVisible();
    await detail().getByRole("button", { name: "知识点更多" }).click();
    await page
      .getByRole("menuitem", { name: "编辑知识点", exact: true })
      .click();
    sheet = page.getByRole("dialog", { name: "编辑知识点", exact: true });
    await sheet.getByLabel("知识点标题").fill("保留冲突中的输入");
    const old = await stored();
    expect(
      (
        await context.request.patch(`${memory}/topics/${topicId}`, {
          headers: headers(),
          data: {
            id: topicId,
            title: topicTitle,
            description: old.description,
            expected_version: old.version,
          },
        })
      ).status(),
    ).toBe(200);
    await sheet.getByRole("button", { name: "保存知识点" }).click();
    await expect(sheet.getByRole("alert")).toContainText("当前输入已保留");
    await expect(sheet.getByLabel("知识点标题")).toHaveValue(
      "保留冲突中的输入",
    );
    page.once("dialog", (dialog) => dialog.accept());
    await sheet.getByRole("button", { name: "关闭", exact: true }).click();
    await recall().getByRole("button", { name: "回忆题更多" }).click();
    await page.getByRole("menuitem", { name: "停用回忆题" }).click();
    const retire = page.getByRole("dialog", {
      name: "停用回忆题",
      exact: true,
    });
    await expect(retire).toContainText("作答历史、错因和掌握记录保留");
    await retire.getByRole("button", { name: "确认停用回忆题" }).click();
    await expect(recall()).toHaveCount(0);
    const history = await (
      await context.request.get(`${memory}/topics/${topicId}/attempts`)
    ).json();
    expect(
      history.attempts.filter(
        (a: { quiz_item_id: string }) => a.quiz_item_id === quizId,
      ),
    ).toHaveLength(3);
    await detail().getByRole("button", { name: "知识点更多" }).click();
    await page
      .getByRole("menuitem", { name: "删除知识点", exact: true })
      .click();
    const blocked = page.getByRole("dialog", {
      name: "删除知识点",
      exact: true,
    });
    await expect(blocked.getByRole("alert")).toContainText("作答历史");
    await expect(
      blocked.getByRole("button", { name: "确认删除知识点" }),
    ).toBeDisabled();
    await blocked.getByRole("button", { name: "取消", exact: true }).click();
  });

  test("create and edit topics, add a prerequisite, follow its locator and delete safely", async () => {
    await page.getByRole("button", { name: "新建知识点", exact: true }).click();
    let sheet = page.getByRole("dialog", { name: "新建知识点", exact: true });
    await sheet.getByLabel("知识点标题").fill("条件：数据开放");
    await sheet.getByLabel("知识点说明").fill("需要公开实验数据。");
    await sheet.getByRole("button", { name: "保存知识点" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      detail().getByRole("heading", { name: "条件：数据开放", exact: true }),
    ).toBeVisible();
    await detail().getByRole("button", { name: "知识点更多" }).click();
    await page
      .getByRole("menuitem", { name: "编辑知识点", exact: true })
      .click();
    sheet = page.getByRole("dialog", { name: "编辑知识点", exact: true });
    await sheet.getByLabel("知识点标题").fill("条件：公开可复核的数据");
    await sheet.getByRole("button", { name: "保存知识点" }).click();
    await expect(
      detail().getByRole("heading", {
        name: "条件：公开可复核的数据",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: new RegExp(topicTitle) }).click();
    await detail().getByText("先修关系", { exact: true }).click();
    await detail().getByRole("button", { name: "添加先修关系" }).click();
    sheet = page.getByRole("dialog", { name: "添加先修关系", exact: true });
    await sheet
      .getByRole("combobox", { name: "先修知识点", exact: true })
      .selectOption({ label: "条件：公开可复核的数据" });
    await sheet.getByRole("button", { name: "保存先修关系" }).click();
    await detail()
      .getByRole("link", { name: "条件：公开可复核的数据", exact: true })
      .click();
    await expect(
      detail().getByRole("heading", {
        name: "条件：公开可复核的数据",
        exact: true,
      }),
    ).toBeVisible();
    await detail().getByText("先修关系", { exact: true }).click();
    await detail().getByRole("button", { name: "先修关系更多" }).click();
    await page
      .getByRole("menuitem", { name: "删除先修关系", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除先修关系", exact: true })
      .getByRole("button", { name: "确认删除先修关系" })
      .click();
    await expect(
      detail().getByRole("button", { name: "先修关系更多" }),
    ).toHaveCount(0);
    await detail().getByRole("button", { name: "知识点更多" }).click();
    await page
      .getByRole("menuitem", { name: "删除知识点", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "删除知识点", exact: true })
      .getByRole("button", { name: "确认删除知识点" })
      .click();
    await expect(detail()).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(topicTitle) }).click();
    await expect(
      detail().getByRole("heading", { name: topicTitle, exact: true }),
    ).toBeVisible();
  });

  test("unified review supports keyboard, four widths, themes and no offline storage", async ({}, testInfo) => {
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
        await page
          .getByRole("heading", { name: "复习", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`unified-review-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    await detail()
      .getByRole("combobox", { name: "掌握程度", exact: true })
      .focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      detail().getByRole("combobox", { name: "掌握程度", exact: true }),
    ).toBeFocused();
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
