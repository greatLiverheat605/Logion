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
});
