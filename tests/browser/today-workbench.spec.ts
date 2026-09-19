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

test("Today can unlock while the Space list is still loading", async ({
  accountState,
  page,
}) => {
  let releaseSpaces!: () => void;
  let spaceRequested!: () => void;
  const held = new Promise<void>((resolve) => {
    releaseSpaces = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    spaceRequested = resolve;
  });
  await page.route("**/api/v1/workspaces/*/spaces", async (route) => {
    spaceRequested();
    await held;
    await route.continue();
  });
  try {
    await page.goto("/app/today");
    await requested;
    await page
      .getByLabel("本地资料口令")
      .fill(
        process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() ||
          accountState.password,
      );
    const unlock = page.getByRole("button", { name: "解锁", exact: true });
    await expect(unlock).toBeEnabled();
    await unlock.click();
    await expect(
      page.getByRole("button", { name: "本地资料已解锁" }),
    ).toBeVisible();
  } finally {
    releaseSpaces();
    await page.unrouteAll({ behavior: "wait" });
  }
});

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
      name: "解锁本地资料",
    });
    if (await planningUnlockTrigger.isVisible()) {
      await planningUnlockTrigger.click();
      const unlockSheet = page.getByRole("dialog", { name: "解锁本地资料" });
      await unlockSheet.getByLabel("本地口令").fill(vaultPassphrase);
      await unlockSheet.getByRole("button", { name: "解锁本地资料" }).click();
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
  await expect(startSession).toBeVisible();
  const sessionInspector = page.getByTestId("today-inspector");
  await expect(sessionInspector).toContainText("· completed");
  await expect(sessionInspector).not.toContainText("未结束");

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
  const closedTask = page.waitForResponse(async (response) => {
    if (!response.url().endsWith("/sync/pull") || !response.ok()) return false;
    const body = (await response.json()) as {
      changes?: Array<{
        entity_type: string;
        payload: { title?: string; status?: string };
      }>;
    };
    return Boolean(
      body.changes?.some(
        (change) =>
          change.entity_type === "task" &&
          change.payload.title === taskTitle &&
          change.payload.status === "done",
      ),
    );
  });
  await closeButton.click();
  await closedTask;
  await expect(page.getByTestId("today-queue")).not.toContainText(taskTitle);
  expect(
    runtimeProblems,
    "Today must not emit browser warnings or errors",
  ).toEqual([]);
});

test("Browser defects: task feedback, template pull, locked states and mobile shell", async ({
  page,
  accountState,
}, testInfo) => {
  test.setTimeout(180_000);
  const goalTitle = `Browser-fix-${Date.now()}`;
  await page.goto("/app/planning");
  await expect(
    page.getByTestId("planning-goals").getByText("资料已锁定，解锁后读取"),
  ).toBeVisible();
  await page.getByRole("button", { name: "解锁本地资料", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("本地口令").fill(accountState.password);
  await dialog
    .getByRole("button", { name: "解锁本地资料", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "新建目标", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("目标名称").fill(goalTitle);
  await dialog.getByLabel("可验收成果").fill("浏览器验收记录");
  await dialog.getByLabel("阶段名称").fill("第一阶段");
  await dialog.getByLabel("预计分钟").fill("480");
  await dialog.getByLabel("验收标准").fill("通过回归");
  await dialog.getByRole("button", { name: "保存目标" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("link", { name: "打开 Today" }).click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("任务名称").fill(`${goalTitle}-task`);
  await dialog.getByLabel("关联目标").selectOption({ label: goalTitle });
  await dialog.getByLabel("阶段（可选）").selectOption({ label: "第一阶段" });
  await dialog.getByLabel("预计分钟").fill("960");
  await dialog.getByLabel("说明（可选）").fill("最后输入");
  await dialog.getByRole("button", { name: "保存任务" }).click();
  await expect(dialog.getByRole("alert")).toContainText("预计分钟不能超过 480");
  const errorToast = page
    .locator('[data-sonner-toast][data-type="error"]')
    .filter({ hasText: "预计分钟不能超过 480" });
  await expect(errorToast).toBeVisible();
  await expect(errorToast).toHaveCSS("opacity", "1");
  await page.screenshot({ path: testInfo.outputPath("p0-task-error.png") });
  await dialog.getByLabel("预计分钟").fill("480");
  await dialog.getByRole("button", { name: "保存任务" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("complementary", { name: "今日序列" }),
  ).toContainText(`${goalTitle}-task`);
  const goalsLoaded = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/spaces\/[^/]+\/goals$/.test(new URL(response.url()).pathname),
  );
  await page.locator('a[href="/app/templates"]').first().click();
  const goalsResponse = await goalsLoaded;
  expect(goalsResponse.ok(), await goalsResponse.text()).toBe(true);
  const initialGoalCount = (
    (await goalsResponse.json()) as { goals: Array<{ id: string }> }
  ).goals.length;
  const goalCount = page.getByTestId("templates-installed").locator("strong");
  await expect(goalCount).toHaveText(String(initialGoalCount));
  await page.getByRole("button", { name: /研究项目 · 问题到证据/ }).click();
  await page.getByRole("button", { name: "安装独立副本", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("安装起始日期").fill("2026-09-13");
  const installationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/template-installations"),
  );
  await dialog.getByRole("button", { name: "确认安装" }).click();
  const installation = await installationResponse;
  expect(installation.ok(), await installation.text()).toBe(true);
  const installedGoalId = (
    (await installation.json()) as { installed_object_ids: { goal_id: string } }
  ).installed_object_ids.goal_id;
  const installedGoal = page.locator(`[data-goal-id="${installedGoalId}"]`);
  await expect(dialog).toHaveCount(0);
  await expect(goalCount).toHaveText(String(initialGoalCount + 1));
  await page.locator('a[href="/app/planning"]').first().click();
  await expect(installedGoal).toContainText("研究项目");
  // Simulate a pre-fix cache missing objects after its cursor has advanced.
  await page.evaluate(async () => {
    const info = (await indexedDB.databases()).find((item) =>
      item.name?.startsWith("logion-offline"),
    );
    if (!info?.name) throw new Error("Missing test database");
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open(info.name!);
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        const db = opening.result;
        const tx = db.transaction(["entities", "outbox"], "readwrite");
        const pending = tx.objectStore("outbox").count();
        pending.onsuccess = () => {
          if (pending.result) {
            tx.abort();
            return;
          }
          const store = tx.objectStore("entities");
          const rows = store.openCursor();
          rows.onsuccess = () => {
            const cursor = rows.result;
            if (!cursor) return;
            if (
              cursor.value.entity_type === "learning_goal" &&
              cursor.value.sync_status === "clean"
            )
              cursor.delete();
            cursor.continue();
          };
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          reject(new Error("Cannot alter a pending test cache"));
        };
      };
    });
  });
  await page.locator('a[href="/app/today"]').first().click();
  await page.locator('a[href="/app/planning"]').first().click();
  await expect(installedGoal).toHaveCount(0);
  await page
    .getByRole("button", { name: "补全服务器资料", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "补全服务器资料" })
    .getByRole("button", { name: "确认补全" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(installedGoal).toContainText("研究项目");

  await page.screenshot({
    path: testInfo.outputPath("p1-template-planning.png"),
  });
  await installedGoal.click();
  await page.getByRole("button", { name: "删除学习目标", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "确认删除" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(installedGoal).toHaveCount(0);
  await page.locator('a[href="/app/templates"]').first().click();
  await expect(goalCount).toHaveText(String(initialGoalCount));
  await page.locator('a[href="/app/planning"]').first().click();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".app-mobile-menu")).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".app-sidebar")
        .evaluate((node) => node.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("p2-mobile-375.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await expect(
    page.getByTestId("planning-goals").getByText("资料已锁定，解锁后读取"),
  ).toBeVisible();
  await page.goto("/app/today");
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("资料已锁定，解锁后读取")).toBeVisible();
  await expect(dialog.getByText("当前 Space 还没有可关联的目标。")).toHaveCount(
    0,
  );
  await page.goto("/app/search");
  await expect(page.getByText("资料已锁定，解锁后读取")).toBeVisible();
});
