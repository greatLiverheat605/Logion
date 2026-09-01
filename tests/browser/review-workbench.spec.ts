import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";
import {
  assertGlmPrimaryContract,
  assertGlmRouteRegions,
  assertGlmShellGeometry,
  assertGlmWorkbenchGeometry,
  loadGlmTargetManifest,
} from "./glm-conformance";
import {
  assertNoHorizontalOverflow,
  assertPrimaryActionContract,
  assertReducedMotion,
  captureEvidenceScreenshot,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("Review exposes the due queue, answer sheet and knowledge inspector", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const manifest = loadGlmTargetManifest();
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright") {
      return;
    }
    if (entry.type() === "error" || entry.type() === "warning") {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) => runtimeProblems.push(error.message));

  await page.goto("/app/review", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/review");
  await expect(
    page.getByRole("heading", { name: "把“看过”变成真正能回忆" }),
  ).toBeVisible();
  await expect(page.getByTestId("review-due-queue")).toBeAttached();
  await expect(page.getByTestId("review-answer")).toBeAttached();
  await expect(page.getByTestId("review-inspector")).toBeAttached();
  await expect(page.getByTestId("review-misconceptions")).toBeAttached();
  await expect(page.getByTestId("review-cycle")).toBeAttached();

  const unlockTrigger = page.getByRole("button", {
    exact: true,
    name: "解锁资料",
  });
  if (await unlockTrigger.isVisible()) {
    await unlockTrigger.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地复习资料" });
    await expect(sheet.getByLabel("本地口令")).toBeFocused();
    await sheet.getByLabel("本地口令").fill("review-e2e-passphrase");
    await sheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(sheet).toHaveCount(0);
  }

  const topicTitle = `Review E2E ${Date.now()}`;
  await page.getByRole("button", { exact: true, name: "新建知识点" }).click();
  const topicSheet = page.getByRole("dialog", { name: "新建知识点" });
  await topicSheet.getByLabel("名称").fill(topicTitle);
  await topicSheet.getByLabel("说明").fill("用于真实 Review 复习闭环验收。");
  await topicSheet.getByRole("button", { name: "保存知识点" }).click();
  await expect(topicSheet).toHaveCount(0);
  const topicButton = page.getByRole("button", {
    name: new RegExp(topicTitle),
  });
  await expect(topicButton).toBeVisible();
  await topicButton.click();

  await page.getByRole("tab", { name: /掌握与图谱/ }).click();
  await expect(page.getByRole("button", { name: "图谱" })).toBeVisible();
  await page.getByRole("button", { name: "列表与掌握确认" }).click();
  await expect(
    page.getByRole("heading", { name: /掌握与先修关系/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建主动回忆题" }).click();
  const quizSheet = page.getByRole("dialog", { name: "新建主动回忆题" });
  await quizSheet
    .getByLabel("题目")
    .fill("请说明这个知识点在真实任务中的关键判断。");
  await quizSheet.getByLabel("参考答案").fill("先明确约束，再验证证据。");
  await quizSheet.getByLabel("解析（可选）").fill("答案应体现约束与证据意识。");
  await quizSheet.getByRole("button", { name: "加密保存题目" }).click();
  await expect(quizSheet).toHaveCount(0);

  await page.getByRole("tab", { name: "到期复习" }).click();
  const startRecall = page.getByTestId("review-answer").getByRole("button", {
    exact: true,
    name: "开始回忆",
  });
  await expect(startRecall).toBeVisible();
  await startRecall.click();
  const answerSheet = page.getByRole("dialog", { name: "主动回忆" });
  await answerSheet.getByLabel("我的答案").fill("先明确约束，再验证证据。");
  await answerSheet.getByRole("button", { name: "提交回答" }).click();
  await answerSheet.getByLabel("信心（1-5）").fill("4");
  await answerSheet.getByLabel("用时（秒）").fill("12");
  await answerSheet.getByLabel("若错误，主要原因").selectOption("unknown");
  await answerSheet.getByRole("button", { name: "保存答题记录" }).click();
  await expect(answerSheet).toHaveCount(0);

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/review");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/review", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/review");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/review");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Review ${viewport.label} Axe`).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/review", viewport);
    await assertPrimaryActionContract(page, "/app/review", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/review", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(runtimeProblems).toEqual([]);
});
