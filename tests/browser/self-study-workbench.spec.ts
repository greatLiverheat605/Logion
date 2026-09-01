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

test("Self-study advances a real inbox item into a route, project and deliverable", async ({
  accountState,
  page,
}) => {
  test.setTimeout(300_000);
  const manifest = loadGlmTargetManifest();
  const vaultPassphrase =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright")
      return;
    if (["error", "warning"].includes(entry.type()))
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
  });
  page.on("pageerror", (error) =>
    runtimeProblems.push(`pageerror: ${error.message}`),
  );

  await page.goto("/app/self-study", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/self-study");
  const unlock = page
    .getByRole("button", { exact: true, name: "解锁资料" })
    .first();
  if (await unlock.isVisible()) {
    await unlock.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地学习资料" });
    await sheet.getByLabel("本地口令").fill(vaultPassphrase);
    await sheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(sheet).toHaveCount(0);
  }

  const inboxTitle = `Self-study 捕获 ${Date.now()}`;
  const routeTitle = `Self-study 路线 ${Date.now()}`;
  const projectTitle = `Self-study 项目 ${Date.now()}`;
  const deliverableTitle = `Self-study 成果 ${Date.now()}`;

  await page.locator('[data-workbench-primary="true"]:visible').click();
  const inboxSheet = page.getByRole("dialog", { name: "快速收集想法" });
  await inboxSheet.getByLabel("想法或资料标题").fill(inboxTitle);
  await inboxSheet.getByLabel("备注").fill("用于真实 Self-study 工作台验收。");
  await inboxSheet.getByRole("button", { name: "快速收集想法" }).click();
  await expect(inboxSheet).toHaveCount(0);
  await expect(page.getByTestId("self-study-inbox")).toContainText(inboxTitle);

  await page.getByRole("button", { name: "开始分诊", exact: true }).click();
  await page.getByRole("button", { name: "建立路线", exact: true }).click();
  const routeSheet = page.getByRole("dialog", { name: "新建学习路线" });
  await routeSheet.getByLabel("路线名称").fill(routeTitle);
  await routeSheet.getByLabel("路线目标").fill("形成可复核的系统设计能力。");
  await routeSheet.getByRole("button", { name: "新建学习路线" }).click();
  await expect(routeSheet).toHaveCount(0);
  await expect(page.getByTestId("self-study-projects")).toContainText(
    routeTitle,
  );

  await page
    .getByTestId("self-study-projects")
    .getByRole("button", { name: new RegExp(routeTitle) })
    .click();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  const projectSheet = page.getByRole("dialog", { name: "新建学习项目" });
  await projectSheet.getByLabel("所属路线").selectOption({ label: routeTitle });
  await projectSheet.getByLabel("项目名称").fill(projectTitle);
  await projectSheet.getByLabel("预期成果").fill("完成一份可复核的设计说明。");
  await projectSheet.getByRole("button", { name: "新建学习项目" }).click();
  await expect(projectSheet).toHaveCount(0);
  await expect(page.getByTestId("self-study-projects")).toContainText(
    projectTitle,
  );

  await page
    .getByTestId("self-study-projects")
    .getByRole("button", { name: new RegExp(projectTitle) })
    .click();
  await page
    .getByRole("button", { name: "记录成果", exact: true })
    .first()
    .click();
  const deliverableSheet = page.getByRole("dialog", { name: "记录已完成成果" });
  await deliverableSheet
    .getByLabel("所属项目")
    .selectOption({ label: projectTitle });
  await deliverableSheet.getByLabel("成果名称").fill(deliverableTitle);
  await deliverableSheet
    .getByLabel("完成证据摘要")
    .fill("完成设计说明并通过人工复核。");
  await deliverableSheet
    .getByRole("button", { name: "记录已完成成果" })
    .click();
  await expect(deliverableSheet).toHaveCount(0);
  await expect(page.getByTestId("self-study-deliverables")).toContainText(
    deliverableTitle,
  );

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/self-study");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/self-study", viewport);
    await assertWorkbenchViewportFill(page, "/app/self-study", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/self-study");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/self-study");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Self-study ${viewport.label} Axe`).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/self-study", viewport);
    await assertPrimaryActionContract(page, "/app/self-study", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/self-study", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(
    runtimeProblems,
    "Self-study must not emit browser warnings or errors",
  ).toEqual([]);
});
