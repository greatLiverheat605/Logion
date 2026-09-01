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
  assertWorkbenchViewportFill,
  captureEvidenceScreenshot,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("Exam completes the protected planning and mock-exam workflow", async ({ accountState, page }) => {
  test.setTimeout(300_000);
  const manifest = loadGlmTargetManifest();
  const vaultPassphrase = process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright") return;
    if (["error", "warning"].includes(entry.type())) runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
  });
  page.on("pageerror", (error) => runtimeProblems.push(`pageerror: ${error.message}`));

  await page.goto("/app/exam", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/exam");
  await expect(page.getByTestId("exam-list")).toBeAttached();
  await expect(page.getByTestId("exam-coverage")).toBeAttached();
  await expect(page.getByTestId("exam-syllabus")).toBeAttached();
  await expect(page.getByTestId("exam-mocks")).toBeAttached();
  await expect(page.getByTestId("exam-weaknesses")).toBeAttached();

  const unlock = page.getByRole("button", { exact: true, name: "解锁资料" }).first();
  if (await unlock.isVisible()) {
    await unlock.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地备考资料" });
    await expect(sheet.getByLabel("本地口令")).toBeFocused();
    await sheet.getByLabel("本地口令").fill(vaultPassphrase);
    await sheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(sheet).toHaveCount(0);
  }

  const title = `Exam E2E ${Date.now()}`;
  await page.getByTestId("exam-create").click();
  const examSheet = page.getByRole("dialog", { name: "创建考试" });
  await examSheet.getByLabel("考试名称").fill(title);
  await examSheet.getByLabel("考试时间（本地时区）").fill("2026-11-07T09:00");
  await examSheet.getByLabel("目标分（可选）").fill("80");
  await examSheet.getByLabel("满分（与目标分成对）").fill("100");
  await examSheet.getByRole("button", { name: "创建考试" }).click();
  await expect(examSheet).toHaveCount(0);
  await expect(page.getByTestId("exam-list").getByRole("button", { name: new RegExp(title) })).toBeVisible();

  await page.getByTestId("exam-coverage").getByRole("button", { name: "添加科目" }).click();
  const subjectSheet = page.getByRole("dialog", { name: "添加科目" });
  await subjectSheet.getByLabel("科目名称").fill("架构基础");
  await subjectSheet.getByLabel("权重（百分比）").fill("30");
  await subjectSheet.getByRole("button", { name: "添加科目" }).click();
  await expect(subjectSheet).toHaveCount(0);

  await page.getByTestId("exam-syllabus").getByRole("button", { name: "添加大纲节点" }).click();
  const syllabusSheet = page.getByRole("dialog", { name: "添加大纲节点" });
  await syllabusSheet.getByLabel("节点名称").fill("一致性模型");
  await syllabusSheet.getByRole("button", { name: "添加大纲节点" }).click();
  await expect(syllabusSheet).toHaveCount(0);

  await page.getByTestId("exam-mocks").getByRole("button", { name: "安排模考" }).click();
  const mockSheet = page.getByRole("dialog", { name: "安排模考" });
  await mockSheet.getByLabel("模考名称").fill("第一次全真模考");
  await mockSheet.getByLabel("限时（分钟）").fill("90");
  await mockSheet.getByRole("button", { name: "安排模考" }).click();
  await expect(mockSheet).toHaveCount(0);
  await expect(page.getByTestId("exam-mocks")).toContainText("第一次全真模考");

  await page.getByTestId("exam-mocks").getByRole("button", { name: "记录成绩" }).click();
  const scoreSheet = page.getByRole("dialog", { name: "记录成绩" });
  await scoreSheet.getByLabel("已完成模考").selectOption({ label: "第一次全真模考" });
  await scoreSheet.getByLabel("得分").fill("82");
  await scoreSheet.getByLabel("满分").fill("100");
  await scoreSheet.getByLabel("实际用时（分钟）").fill("88");
  await scoreSheet.getByRole("button", { name: "记录成绩" }).click();
  await expect(scoreSheet).toHaveCount(0);

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/exam");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.querySelectorAll<HTMLElement>(".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector").forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/exam", viewport);
    await assertWorkbenchViewportFill(page, "/app/exam", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/exam");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/exam");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Exam ${viewport.label} Axe`).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/exam", viewport);
    await assertPrimaryActionContract(page, "/app/exam", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/exam", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(runtimeProblems).toEqual([]);
});
