import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

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

async function csrfHeaders(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )?.value;
  if (!csrf) throw new Error("Planning context audit has no CSRF cookie.");
  return {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": csrf,
  };
}

test("Planning restores the selected Space after a reload in the same tab", async ({
  page,
}) => {
  await page.goto("/app/planning");
  await waitForWorkbenchReady(page, "/app/planning");
  const workspaces = (await (
    await page.request.get("/api/v1/workspaces")
  ).json()) as { workspaces: Array<{ id: string }> };
  const workspaceId = workspaces.workspaces[0]?.id;
  if (!workspaceId) throw new Error("Planning context audit has no Workspace.");
  const spaceName = `Context restore ${Date.now()}`;
  const created = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces`,
    {
      data: { name: spaceName, visibility: "shared" },
      headers: await csrfHeaders(page),
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  await page.reload();
  await waitForWorkbenchReady(page, "/app/planning");
  const spaceSelect = page.getByRole("combobox", { name: "选择 Space" });
  await expect(spaceSelect).toBeEnabled();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await spaceSelect.click();
    await page
      .getByRole("option", { name: `${spaceName} · 共享`, exact: true })
      .click();
    if ((await spaceSelect.textContent())?.includes(spaceName)) break;
  }
  await expect(spaceSelect).toContainText(spaceName);
  await page.reload();
  await waitForWorkbenchReady(page, "/app/planning");
  await expect(
    page.getByRole("combobox", { name: "选择 Space" }),
  ).toContainText(spaceName);
});

test("Planning revises the route of an existing goal", async ({
  accountState,
  page,
}) => {
  test.setTimeout(180_000);
  const marker = `Route-${Date.now()}`;
  await page.goto("/app/planning");
  await waitForWorkbenchReady(page, "/app/planning");
  const unlockTrigger = page.getByRole("button", {
    exact: true,
    name: "解锁本地资料",
  });
  if (await unlockTrigger.isVisible()) {
    await unlockTrigger.click();
    const unlockSheet = page.getByRole("dialog", { name: "解锁本地资料" });
    await unlockSheet
      .getByLabel("本地口令")
      .fill(
        process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() ||
          accountState.password,
      );
    await unlockSheet.getByRole("button", { name: "解锁本地资料" }).click();
    await expect(unlockSheet).toHaveCount(0);
  }
  await page.getByRole("button", { name: "新建目标" }).click();
  const goalSheet = page.getByRole("dialog", { name: "新建目标" });
  await goalSheet.getByLabel("目标名称").fill(`${marker} 目标`);
  await goalSheet.getByLabel("可验收成果").fill("路线修订验收");
  await goalSheet.getByLabel("阶段名称").fill(`${marker} 第一阶段`);
  await goalSheet.getByLabel("预计分钟").fill("60");
  await goalSheet.getByLabel("验收标准").fill("第一阶段完成");
  await goalSheet.getByRole("button", { name: "保存目标" }).click();
  await expect(goalSheet).toHaveCount(0);
  await expect(
    page.getByText("目标与首个阶段已保存并同步。").first(),
  ).toBeVisible();

  const stages = page.getByTestId("planning-stages");
  const edit = stages.getByRole("button", { name: "编辑路线", exact: true });
  await expect(edit).toBeEnabled();
  await edit.click();
  const routeSheet = page.getByRole("dialog", { name: "编辑路线" });
  await routeSheet.getByRole("button", { name: "追加阶段" }).click();
  await routeSheet.getByLabel("阶段名称").last().fill(`${marker} 前置阶段`);
  await routeSheet.getByLabel("验收标准（每行一条）").last().fill("前置完成");
  // Reorder with the keyboard, not by dragging.
  await routeSheet
    .getByRole("button", { name: `上移 ${marker} 前置阶段` })
    .focus();
  await page.keyboard.press("Enter");
  await routeSheet.getByRole("button", { name: "保存路线" }).click();
  await expect(routeSheet).toHaveCount(0);
  await expect(page.getByText("阶段修订已保存并同步。").first()).toBeVisible();
  // Count route phases only; each phase also lists its acceptance criteria.
  const routePhases = page
    .getByTestId("planning-dependencies")
    .locator(":scope > li");
  await expect(routePhases).toHaveCount(2);
  await expect(routePhases.first()).toContainText(`${marker} 前置阶段`);

  await edit.click();
  await routeSheet
    .getByRole("button", { name: `归档 ${marker} 第一阶段` })
    .click();
  await routeSheet.getByRole("button", { name: "保存路线" }).click();
  await expect(routeSheet).toHaveCount(0);
  await expect(routePhases).toHaveCount(1);
  await expect(stages.getByText("已归档阶段（1）")).toBeVisible();
  await expect(edit).toBeFocused();
});

test("Planning completes real goal, task and offline sync workflows", async ({
  accountState,
  page,
}) => {
  test.setTimeout(300_000);
  let expectedOfflineFailure = false;
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    const message = entry.text();
    if (message === "Service Worker registration blocked by Playwright") return;
    if (
      expectedOfflineFailure &&
      /ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(message)
    ) {
      return;
    }
    if (["error", "warning"].includes(entry.type())) {
      runtimeProblems.push(`${entry.type()}: ${message}`);
    }
  });
  page.on("pageerror", (error) => {
    if (
      expectedOfflineFailure &&
      /ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(error.message)
    ) {
      return;
    }
    runtimeProblems.push(`pageerror: ${error.message}`);
  });

  const vaultPassphrase =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const glmManifest = loadGlmTargetManifest();
  const marker = `Planning-${Date.now()}`;
  const onlineGoalTitle = `${marker} 在线目标`;
  const offlineGoalTitle = `${marker} 离线目标`;
  const taskTitle = `${marker} 关联任务`;

  await page.goto("/app/planning", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/planning");
  await expect(page.getByTestId("planning-goals")).toBeAttached();
  await page.setViewportSize(WORKBENCH_VIEWPORTS[2]);
  await waitForWorkbenchReady(page, "/app/planning");
  await assertWorkbenchViewportFill(
    page,
    "/app/planning",
    WORKBENCH_VIEWPORTS[2],
  );

  const unlockTrigger = page.getByRole("button", {
    exact: true,
    name: "解锁本地资料",
  });
  if (await unlockTrigger.isVisible()) {
    await unlockTrigger.click();
    const unlockSheet = page.getByRole("dialog", { name: "解锁本地资料" });
    await expect(unlockSheet.getByLabel("本地口令")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(unlockSheet).toHaveCount(0);
    await expect(unlockTrigger).toBeFocused();

    await unlockTrigger.click();
    await unlockSheet.getByLabel("本地口令").fill(vaultPassphrase);
    await unlockSheet.getByRole("button", { name: "解锁本地资料" }).click();
    await expect(unlockSheet).toHaveCount(0);
  }
  const newGoalTrigger = page.getByRole("button", { name: "新建目标" });
  await expect(
    page.getByRole("button", { name: "本地资料已解锁" }),
  ).toBeVisible();
  await expect(newGoalTrigger).toBeEnabled();
  await newGoalTrigger.click();
  const newGoalSheet = page.getByRole("dialog", { name: "新建目标" });
  await expect(newGoalSheet.getByLabel("目标名称")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(newGoalSheet).toHaveCount(0);
  await expect(newGoalTrigger).toBeFocused();

  await newGoalTrigger.click();
  await newGoalSheet.getByLabel("目标名称").fill(onlineGoalTitle);
  await newGoalSheet
    .getByLabel("可验收成果")
    .fill("提交一份可复核的 Planning 工作台验收记录");
  await newGoalSheet.getByLabel("阶段名称").fill("完成正式任务走查");
  await newGoalSheet.getByLabel("预计分钟").fill("180");
  await newGoalSheet
    .getByLabel("验收标准")
    .fill("目标、阶段、任务与同步状态均可复核");
  await newGoalSheet.getByRole("button", { name: "保存目标" }).click();
  await expect(newGoalSheet).toHaveCount(0);
  await expect(
    page.getByRole("heading", { exact: true, name: onlineGoalTitle }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("planning-stages")
      .getByText("完成正式任务走查", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("目标与首个阶段已保存并同步。").first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "打开 Today" }).click();
  await expect(page).toHaveURL(/\/app\/today$/);
  await waitForWorkbenchReady(page, "/app/today");
  const todayVaultInput = page.getByLabel("本地资料口令");
  if (await todayVaultInput.isVisible()) {
    await todayVaultInput.fill(vaultPassphrase);
    await page.getByRole("button", { name: "解锁", exact: true }).click();
  }
  await page.getByRole("button", { name: "新建任务" }).click();
  const taskSheet = page.getByRole("dialog", { name: "新建今日任务" });
  await taskSheet.getByLabel("任务名称").fill(taskTitle);
  await taskSheet
    .getByLabel("说明（可选）")
    .fill("验证 Today 创建后在 Planning 按目标回显。");
  await taskSheet
    .getByLabel("关联目标")
    .selectOption({ label: onlineGoalTitle });
  await taskSheet.getByRole("button", { name: "保存任务" }).click();
  await expect(taskSheet).toHaveCount(0);

  await page.locator('a[href="/app/planning"]').first().click();
  await expect(page).toHaveURL(/\/app\/planning$/);
  await waitForWorkbenchReady(page, "/app/planning");
  await expect(
    page
      .getByTestId("planning-tasks")
      .getByText(taskTitle, { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId("planning-tasks")).toContainText("已计划");

  expectedOfflineFailure = true;
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await newGoalTrigger.click();
  await newGoalSheet.getByLabel("目标名称").fill(offlineGoalTitle);
  await newGoalSheet
    .getByLabel("可验收成果")
    .fill("网络恢复后完成 sync-v1 同步");
  await newGoalSheet.getByLabel("阶段名称").fill("验证离线保留");
  await newGoalSheet.getByLabel("预计分钟").fill("60");
  await newGoalSheet.getByLabel("验收标准").fill("离线目标可见且标记待同步");
  await newGoalSheet.getByRole("button", { name: "保存目标" }).click();
  await expect(newGoalSheet).toHaveCount(0);
  await expect(
    page.getByRole("heading", { exact: true, name: offlineGoalTitle }),
  ).toBeVisible();
  const offlineGoalRow = page
    .getByTestId("planning-goals")
    .getByRole("button", { name: new RegExp(offlineGoalTitle) });
  await expect(offlineGoalRow).toContainText("待同步");
  await expect(
    page
      .getByText("目标与首个阶段已安全保存在本地，将在网络恢复后同步。")
      .first(),
  ).toBeVisible();

  await page.context().setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  expectedOfflineFailure = false;
  await page
    .getByRole("button", { name: "同步当前 Workspace", exact: true })
    .first()
    .click();
  await expect(page.getByText("目标与任务已同步。").first()).toBeVisible();
  await expect(offlineGoalRow).toContainText("已同步");

  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/planning");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/planning", viewport);
    await assertWorkbenchViewportFill(page, "/app/planning", viewport);
    await assertGlmRouteRegions(page, glmManifest, "/app/planning");
    await assertGlmShellGeometry(page, glmManifest);
    await assertGlmWorkbenchGeometry(page, glmManifest);
    await assertGlmPrimaryContract(page, glmManifest, "/app/planning");
    if (viewport.width < 720) {
      await expect(
        page.getByRole("navigation", { name: "工作台区域" }),
      ).toBeHidden();
      const order = await page
        .locator(
          '[data-testid="planning-goals"], [data-testid="planning-stages"], [data-testid="planning-dependencies"], [data-testid="planning-tasks"], [data-testid="planning-inspector"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.getAttribute("data-testid"),
            top: Math.round(element.getBoundingClientRect().top + scrollY),
          })),
        );
      expect(order.map((item) => item.id)).toEqual([
        "planning-goals",
        "planning-stages",
        "planning-dependencies",
        "planning-tasks",
        "planning-inspector",
      ]);
      expect(
        order.every(
          (item, index) => index === 0 || item.top >= order[index - 1]!.top,
        ),
        `Planning ${viewport.label} must keep a continuous vertical flow: ${JSON.stringify(order)}`,
      ).toBe(true);
    }
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(
      axe.violations,
      `Planning ${viewport.label} must have no automated WCAG violations`,
    ).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/planning", viewport);
    await assertPrimaryActionContract(page, "/app/planning", viewport);
  }

  await page.setViewportSize(WORKBENCH_VIEWPORTS[3]);
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Planning ${theme} theme must pass Axe`).toEqual([]);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/planning", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });

  expect(
    runtimeProblems,
    "Planning must not emit unexpected browser warnings or errors",
  ).toEqual([]);
});
