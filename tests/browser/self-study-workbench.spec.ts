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
    .getByRole("button", { exact: true, name: "解锁本地资料" })
    .first();
  if (await unlock.isVisible()) {
    await unlock.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地学习资料" });
    await sheet.getByLabel("本地口令").fill(vaultPassphrase);
    await sheet.getByRole("button", { name: "解锁本地资料" }).click();
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
  await expect(page.getByTestId("self-study-inbox")).not.toContainText(
    inboxTitle,
  );
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

  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
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

test("Browser remaining: discard inbox and delete an unreferenced topic", async ({
  page,
  accountState,
}) => {
  await page.goto("/app/self-study");
  await page
    .getByRole("button", { name: "解锁本地资料", exact: true })
    .first()
    .click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("本地口令").fill(accountState.password);
  await dialog
    .getByRole("button", { name: "解锁本地资料", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.locator('[data-workbench-primary="true"]:visible').click();
  dialog = page.getByRole("dialog", { name: "快速收集想法" });
  await dialog.getByLabel("想法或资料标题").fill("待丢弃的测试条目");
  await dialog
    .getByRole("button", { name: "快速收集想法", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByTestId("self-study-inbox")
    .getByRole("button", { name: /待丢弃的测试条目/ })
    .click();
  await page
    .getByRole("button", { name: "删除收件箱条目", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "确认删除" });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByTestId("self-study-inbox")).toContainText(
    "待丢弃的测试条目",
  );
  await page
    .getByRole("button", { name: "删除收件箱条目", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "确认删除" })
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(page.getByTestId("self-study-inbox")).not.toContainText(
    "待丢弃的测试条目",
  );
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "删除已同步。" }),
  ).toBeVisible();
  await page.goto("/app/review");
  await page.getByRole("button", { name: "解锁本地资料", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("本地口令").fill(accountState.password);
  await dialog
    .getByRole("button", { name: "解锁本地资料", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "新建知识点", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "新建知识点" });
  await dialog.getByLabel("名称").fill("可删除的测试知识点");
  await dialog.getByRole("button", { name: "保存知识点", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: /可删除的测试知识点/ }).click();
  await page.getByRole("button", { name: "删除知识点", exact: true }).click();
  await page
    .getByRole("dialog", { name: "确认删除" })
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /可删除的测试知识点/ }),
  ).toHaveCount(0);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "删除已同步。" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "本地资料已解锁", exact: true })
    .click();
  await expect(page.getByLabel("解锁剩余时间")).toContainText("30 分钟");
  await page
    .getByRole("dialog", { name: "本地资料保护" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, {
    timeout: 60000,
  });
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    if (width <= 768)
      await expect
        .poll(() =>
          page
            .getByTestId("app-sidebar")
            .evaluate((element) => element.getBoundingClientRect().right <= 1),
        )
        .toBe(true);
    else
      await expect
        .poll(() =>
          page
            .getByTestId("app-sidebar")
            .evaluate((element) => element.getBoundingClientRect().left >= 0),
        )
        .toBe(true);
    if (width <= 768)
      await expect(page.locator(".workbench-pane:visible")).toHaveCount(1);
    await expect(page.locator("body")).toContainText("Personal workspace");
    await page.screenshot({ path: `.local/text-review-${width}.png` });
  }
});
