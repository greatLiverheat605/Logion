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

test("Research completes a traceable question, evidence and experiment workflow", async ({
  accountState,
  page,
}) => {
  test.setTimeout(300_000);
  const manifest = loadGlmTargetManifest();
  const vaultPassphrase =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright") return;
    if (["error", "warning"].includes(entry.type())) {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) => runtimeProblems.push(`pageerror: ${error.message}`));

  await page.goto("/app/research", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/research");
  await expect(page.getByTestId("research-questions")).toBeAttached();
  await expect(page.getByTestId("research-claims")).toBeAttached();
  await expect(page.getByTestId("research-evidence")).toBeAttached();
  await expect(page.getByTestId("research-experiments")).toBeAttached();

  const unlock = page.getByRole("button", { exact: true, name: "解锁资料" }).first();
  if (await unlock.isVisible()) {
    await unlock.click();
    const sheet = page.getByRole("dialog", { name: "解锁研究资料" });
    await expect(sheet.getByLabel("本地口令")).toBeFocused();
    await sheet.getByLabel("本地口令").fill(vaultPassphrase);
    await sheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(sheet).toHaveCount(0);
  }

  const marker = `Research-${Date.now()}`;
  const questionTitle = `${marker} 缓存一致性问题`;
  const paperTitle = `${marker} 论文`;
  const citationKey = `${marker.toLowerCase()}-paper`;
  const claimText = `${marker} 声明支持缓存一致性降低延迟`;
  const runTitle = `${marker} 基准运行`;
  const feedbackText = `${marker} 反馈需要补充负载边界`;

  const questionTrigger = page
    .getByTestId("research-questions")
    .getByRole("button", { name: "新建问题", exact: true });
  await questionTrigger.click();
  const questionSheet = page.getByRole("dialog", { name: "新建研究问题" });
  await questionSheet.getByLabel("研究问题").fill(questionTitle);
  await questionSheet.getByLabel("问题依据").fill("需要用可复核实验验证假设。");
  await questionSheet.getByRole("button", { name: "创建问题" }).click();
  await expect(questionSheet).toHaveCount(0);
  const questionRow = page
    .getByTestId("research-questions")
    .getByRole("button", { name: new RegExp(questionTitle) });
  await expect(questionRow).toBeVisible();
  await questionRow.click();

  await page.getByRole("tab", { name: "论文" }).click();
  await page.getByTestId("research-papers").getByRole("button", { name: "索引论文" }).click();
  const paperSheet = page.getByRole("dialog", { name: "索引论文" });
  await paperSheet.getByLabel("论文标题").fill(paperTitle);
  await paperSheet.getByLabel("Citation Key").fill(citationKey);
  await paperSheet.getByLabel("HTTP(S) 来源（可选）").fill("https://example.com/research-paper");
  await paperSheet.getByRole("button", { name: "保存论文" }).click();
  await expect(paperSheet).toHaveCount(0);
  await expect(page.getByTestId("research-papers")).toContainText(paperTitle);

  await page.getByRole("tab", { name: "声明与证据" }).click();
  await page.getByTestId("research-claims").getByRole("button", { name: "建立声明" }).click();
  const claimSheet = page.getByRole("dialog", { name: "建立声明" });
  await claimSheet.getByLabel("来源论文").selectOption({ label: `${citationKey} · ${paperTitle}` });
  await claimSheet.getByLabel("研究声明").fill(claimText);
  await claimSheet.getByLabel("声明立场").selectOption("supports");
  await claimSheet.getByRole("button", { name: "记录声明" }).click();
  await expect(claimSheet).toHaveCount(0);
  const claimRow = page.getByTestId("research-claims").getByRole("button", { name: new RegExp(claimText) });
  await expect(claimRow).toBeVisible();
  await claimRow.click();
  await expect(page.getByTestId("research-evidence")).toContainText("来源与立场");

  await page.getByTestId("research-evidence").getByRole("button", { name: "记录反馈" }).click();
  const feedbackSheet = page.getByRole("dialog", { name: "记录反馈" });
  await feedbackSheet.getByLabel("关联声明").selectOption({ label: claimText });
  await feedbackSheet.getByLabel("反馈").fill(feedbackText);
  await feedbackSheet.getByLabel("建议动作（可选）").fill("补充高负载实验。");
  await feedbackSheet.getByRole("button", { name: "记录反馈" }).click();
  await expect(feedbackSheet).toHaveCount(0);
  await expect(page.getByTestId("research-evidence")).toContainText(feedbackText);

  await page.getByRole("tab", { name: "实验与指标" }).click();
  await page.getByTestId("research-experiments").getByRole("button", { name: "记录已完成运行" }).click();
  const runSheet = page.getByRole("dialog", { name: "记录已完成运行" });
  await runSheet.getByLabel("所属研究问题").selectOption({ label: questionTitle });
  await runSheet.getByLabel("实验运行名称").fill(runTitle);
  await runSheet.getByLabel("方法摘要").fill("在两个负载档位运行基准测试。");
  await runSheet.getByRole("button", { name: "记录运行" }).click();
  await expect(runSheet).toHaveCount(0);
  const runRegion = page.getByTestId("research-experiments");
  await expect(runRegion).toContainText(runTitle);

  await runRegion.getByRole("button", { name: "指标" }).first().click();
  const metricSheet = page.getByRole("dialog", { name: "追加指标" });
  await metricSheet.getByLabel("所属实验运行").selectOption({ label: runTitle });
  await metricSheet.getByLabel("指标名称").fill("p95 latency");
  await metricSheet.getByLabel("数值").fill("42");
  await metricSheet.getByLabel("单位").fill("ms");
  await metricSheet.getByRole("button", { name: "追加指标" }).click();
  await expect(metricSheet).toHaveCount(0);
  await expect(runRegion).toContainText("p95 latency");

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/research");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/research", viewport);
    await assertWorkbenchViewportFill(page, "/app/research", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/research");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/research");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Research ${viewport.label} Axe`).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/research", viewport);
    await assertPrimaryActionContract(page, "/app/research", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/research", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(runtimeProblems, "Research must not emit browser warnings or errors").toEqual([]);
});
