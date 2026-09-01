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
  assertWorkbenchViewportFill,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test("Today completes a real execution loop and four-breakpoint audit", async ({
  accountState,
  page,
}) => {
  test.setTimeout(300_000);
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright") {
      return;
    }
    if (["error", "warning"].includes(entry.type())) {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    runtimeProblems.push(`pageerror: ${error.message}`),
  );
  const vaultPassphrase =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const glmManifest = loadGlmTargetManifest();

  await page.goto("/app/today", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/today");
  const vaultInput = page.getByLabel("本地资料口令");
  if (await vaultInput.isVisible()) {
    await vaultInput.fill(vaultPassphrase);
    await page.getByRole("button", { name: "解锁", exact: true }).click();
  }
  await expect(page.getByText(/本地资料已在应用内解锁/).first()).toBeVisible();

  await page.getByRole("button", { name: "新建任务" }).click();
  const preflightSheet = page.getByRole("dialog", { name: "新建今日任务" });
  await expect(preflightSheet).toBeVisible();
  const goalSelect = preflightSheet.getByLabel("关联目标");
  const noGoalMessage = preflightSheet.getByText(
    "当前 Space 还没有可关联的目标。",
  );
  await expect(goalSelect.or(noGoalMessage)).toBeVisible();
  const needsGoal = await noGoalMessage.isVisible();
  await preflightSheet.getByRole("button", { name: "取消" }).click();
  await expect(preflightSheet).toHaveCount(0);

  let goalTitle: string | undefined;
  if (needsGoal) {
    await page.locator('a[href="/app/planning"]').first().click();
    await expect(page).toHaveURL(/\/app\/planning$/);
    await waitForWorkbenchReady(page, "/app/planning");
    const planningUnlockTrigger = page.getByRole("button", {
      exact: true,
      name: "解锁资料",
    });
    if (await planningUnlockTrigger.isVisible()) {
      await planningUnlockTrigger.click();
      const unlockSheet = page.getByRole("dialog", { name: "解锁本地资料" });
      await unlockSheet.getByLabel("本地口令").fill(vaultPassphrase);
      await unlockSheet.getByRole("button", { name: "解锁资料" }).click();
      await expect(unlockSheet).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: "本地资料已解锁" }),
    ).toBeVisible();

    goalTitle = `B1 真实目标 ${Date.now()}`;
    await page.getByRole("button", { name: "新建目标" }).click();
    const goalSheet = page.getByRole("dialog", { name: "新建目标" });
    await goalSheet.getByLabel("目标名称").fill(goalTitle);
    await goalSheet
      .getByLabel("可验收成果")
      .fill("提交一份可复核的 B1 执行记录");
    await goalSheet.getByLabel("阶段名称").fill("完成真实工作台走查");
    await goalSheet.getByLabel("预计分钟").fill("60");
    await goalSheet
      .getByLabel("验收标准")
      .fill("任务、会话、证据和人工验收均留有真实记录");
    await goalSheet.getByRole("button", { name: "保存目标" }).click();
    await expect(goalSheet).toHaveCount(0);
    await expect(
      page.getByRole("heading", { exact: true, name: goalTitle }),
    ).toBeVisible();

    await page.locator('a[href="/app/today"]').first().click();
    await expect(page).toHaveURL(/\/app\/today$/);
    await waitForWorkbenchReady(page, "/app/today");
  }

  const taskTitle = `B1 真实任务 ${Date.now()}`;
  await page.getByRole("button", { name: "新建任务" }).click();
  const taskSheet = page.getByRole("dialog", { name: "新建今日任务" });
  await expect(taskSheet).toBeVisible();
  await taskSheet.getByLabel("任务名称").fill(taskTitle);
  await taskSheet
    .getByLabel("说明（可选）")
    .fill("用于 Gate 1 的真实 Session/API/Vault/sync-v1 走查。");
  if (goalTitle) {
    await taskSheet.getByLabel("关联目标").selectOption({ label: goalTitle });
  }
  await taskSheet.getByRole("button", { name: "保存任务" }).click();
  await expect(taskSheet).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(taskTitle) }).click();
  await expect(
    page.getByRole("heading", { name: taskTitle }).first(),
  ).toBeVisible();

  const startSession = page.getByRole("button", { name: "开始专注" });
  if (!(await startSession.isVisible())) {
    await page.getByRole("button", { name: "结束会话" }).click();
    const cleanupSheet = page.getByRole("dialog", { name: "结束专注会话" });
    await cleanupSheet.getByLabel("实际分钟").fill("1");
    await cleanupSheet.getByLabel("结束方式").selectOption("abandoned");
    await cleanupSheet.getByRole("button", { name: "保存会话" }).click();
    await expect(cleanupSheet).toHaveCount(0);
  }
  await expect(startSession).toBeVisible();
  await startSession.click();
  await expect(page.getByRole("button", { name: "结束会话" })).toBeVisible();

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/today");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(".app-content, .workbench-pane")
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/today", viewport);
    await assertWorkbenchViewportFill(page, "/app/today", viewport);
    await assertGlmRouteRegions(page, glmManifest, "/app/today");
    await assertGlmShellGeometry(page, glmManifest);
    await assertGlmWorkbenchGeometry(page, glmManifest);
    await assertGlmPrimaryContract(page, glmManifest, "/app/today");
    if (viewport.width < 720) {
      await expect(
        page.getByRole("navigation", { name: "工作台区域" }),
      ).toBeHidden();
      const order = await page
        .locator(
          '[data-testid="today-queue"], [data-testid="today-next-action"], [data-testid="today-evidence"], [data-testid="today-signals"], [data-testid="today-trend"], [data-testid="today-inspector"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.getAttribute("data-testid"),
            top: Math.round(element.getBoundingClientRect().top + scrollY),
          })),
        );
      expect(
        order.map((item) => item.id),
        `Today ${viewport.label} must keep the approved continuous region order`,
      ).toEqual([
        "today-queue",
        "today-next-action",
        "today-evidence",
        "today-signals",
        "today-trend",
        "today-inspector",
      ]);
      expect(
        order.every(
          (item, index) => index === 0 || item.top >= order[index - 1]!.top,
        ),
        `Today ${viewport.label} regions must flow vertically: ${JSON.stringify(order)}`,
      ).toBe(true);
    }
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(
      axe.violations,
      `Today ${viewport.label} must have no automated WCAG violations`,
    ).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/today", viewport);
    const primary = page.locator('[data-workbench-primary="true"]:visible');
    if (await primary.count()) await primary.first().scrollIntoViewIfNeeded();
    await assertPrimaryActionContract(page, "/app/today", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/today", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(WORKBENCH_VIEWPORTS[3]);

  const personaTrigger = page.getByRole("button", { name: "画像详情" });
  await personaTrigger.click();
  await expect(
    page.getByRole("dialog", { name: "Persona 今日信号" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Persona 今日信号" }),
  ).toHaveCount(0);
  await expect(personaTrigger).toBeFocused();

  await page.getByRole("button", { name: "结束会话" }).click();
  const finishSheet = page.getByRole("dialog", { name: "结束专注会话" });
  await finishSheet.getByLabel("实际分钟").fill("1");
  await finishSheet
    .getByLabel("反思与下一步（可选）")
    .fill("会话完成，继续提交验收证据。");
  await finishSheet.getByRole("button", { name: "保存会话" }).click();
  await expect(finishSheet).toHaveCount(0);

  await page.getByRole("button", { name: "添加证据" }).click();
  const evidenceSheet = page.getByRole("dialog", { name: "添加任务证据" });
  await expect(evidenceSheet.getByLabel("证据说明")).toBeFocused();
  await evidenceSheet
    .getByLabel("证据说明")
    .fill("B1 Today 工作台真实任务链路验收证据");
  await evidenceSheet.getByRole("button", { name: "保存证据" }).click();
  await expect(evidenceSheet).toHaveCount(0);

  const verifyButton = page.getByRole("button", { name: "提交验收决定" });
  await expect(verifyButton).toBeVisible();
  await verifyButton.click();
  const verificationSheet = page.getByRole("dialog", { name: "人工验收" });
  await verificationSheet
    .getByLabel("验收意见")
    .fill("证据完整，人工确认通过。");
  await verificationSheet.getByRole("button", { name: "确认验收" }).click();
  await expect(verificationSheet).toHaveCount(0);

  const closeButton = page.getByRole("button", { name: "关闭已验收任务" });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(page.getByText("已关闭", { exact: true }).first()).toBeVisible();
  expect(
    runtimeProblems,
    "Today must not emit browser warnings or errors",
  ).toEqual([]);
});
