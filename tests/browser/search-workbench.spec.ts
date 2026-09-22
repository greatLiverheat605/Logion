import { createHash, randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, reauthenticateForSensitiveJourney, test } from "./fixtures";
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

test("M06 groups real sync receipts with persistent individual reads and explicit rejected operations", async ({
  accountState,
  page,
}) => {
  test.setTimeout(120_000);
  await reauthenticateForSensitiveJourney(page, accountState);
  const workspaceId = (
    await (await page.request.get("/api/v1/workspaces")).json()
  ).workspaces[0].id as string;
  const deviceId = (
    await (await page.request.get("/api/v1/auth/devices")).json()
  ).devices.find((device: { current: boolean }) => device.current).id as string;
  const headers = await csrfHeaders(page);
  const bootstrap = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/sync/bootstrap`,
    {
      headers,
      data: {
        message_type: "bootstrap_request",
        protocol_version: "sync-v1",
        workspace_id: workspaceId,
        device_id: deviceId,
        known_sync_epoch: null,
        snapshot_id: null,
        chunk_index: null,
      },
    },
  );
  expect(bootstrap.status(), await bootstrap.text()).toBe(200);
  const epoch = (await bootstrap.json()).sync_epoch as string;
  const operation = (index: number, entityType = "space") => {
    const payload = {
      name: `M06 synthetic ${index} ${Date.now()}`,
      visibility: "private",
    };
    return {
      operation_id: randomUUID(),
      protocol_version: "sync-v1",
      workspace_id: workspaceId,
      device_id: deviceId,
      entity_type: entityType,
      entity_id: randomUUID(),
      operation_type: "create",
      base_version: 0,
      client_occurred_at: new Date().toISOString(),
      payload,
      payload_hash:
        "sha256:" +
        createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
      dependencies: [],
    };
  };
  for (let index = 0; index < 3; index++) {
    const pushed = await page.request.post(
      `/api/v1/workspaces/${workspaceId}/sync/push`,
      {
        headers,
        data: {
          message_type: "push_request",
          protocol_version: "sync-v1",
          workspace_id: workspaceId,
          device_id: deviceId,
          sync_epoch: epoch,
          operations:
            index === 2
              ? [operation(index), operation(9, "note")]
              : [operation(index)],
        },
      },
    );
    expect(pushed.status(), await pushed.text()).toBe(200);
    expect(
      (await pushed.json()).results.map(
        (result: { status: string }) => result.status,
      ),
    ).toEqual(index === 2 ? ["applied", "rejected"] : ["applied"]);
  }
  const notificationsUrl = `/api/v1/workspaces/${workspaceId}/notifications`;
  const list = (await (await page.request.get(notificationsUrl)).json())
    .notifications as Array<{
    id: string;
    summary: string;
    read_at: string | null;
    category: string;
  }>;
  const ordinary = list.filter(
    (item) =>
      item.summary ===
      "服务端已接收 1 项；待处理冲突 0 项；未接收 0 项；已解决冲突 0 项。",
  );
  const rejected = list.find((item) => item.summary.includes("未接收 1 项"))!;
  expect(ordinary.length).toBeGreaterThanOrEqual(2);
  expect(rejected).toBeTruthy();
  await page.goto("/app/search");
  await page.getByRole("tab", { name: /通知/ }).click();
  const summary = page
    .locator("summary")
    .filter({ hasText: "普通同步推送回执" });
  await expect(summary).toBeVisible();
  const rejectedRow = page.locator(`[data-notification-id="${rejected.id}"]`);
  await expect(rejectedRow).toBeVisible();
  await expect(rejectedRow).toContainText("未接收 1 项");
  await summary.focus();
  await page.keyboard.press("Enter");
  const first = page.locator(`[data-notification-id="${ordinary[0]!.id}"]`);
  await expect(first).toBeVisible();
  await first.getByRole("button", { name: "标为已读" }).click();
  await expect(first.getByText("已读", { exact: true })).toBeVisible();
  const reread = (await (await page.request.get(notificationsUrl)).json())
    .notifications as typeof list;
  expect(
    reread.find((item) => item.id === ordinary[0]!.id)?.read_at,
  ).toBeTruthy();
  const unread = reread.filter(
    (item) => item.read_at === null && item.category !== "billing",
  ).length;
  await page.getByRole("button", { name: "打开通知中心" }).click();
  await expect(
    page.getByRole("dialog", { name: `${unread} 条未读通知` }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations).toEqual([]);
  }
  await page.reload();
  await page.getByRole("tab", { name: /通知/ }).click();
  await page.locator("summary").filter({ hasText: "普通同步推送回执" }).click();
  await expect(
    page
      .locator(`[data-notification-id="${ordinary[0]!.id}"]`)
      .getByText("已读", { exact: true }),
  ).toBeVisible();
});

async function csrfHeaders(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )?.value;
  if (!csrf) throw new Error("Search real-flow audit has no CSRF cookie.");
  return {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": csrf,
  };
}

test("Search completes real retrieval and utility workflows at four breakpoints", async ({
  accountState,
  page,
}) => {
  test.setTimeout(300_000);
  const runtimeProblems: string[] = [];
  let expectedFeedFailureUrl = "";
  let expectedFeedFailures = 0;
  page.on("console", (entry) => {
    if (
      entry.type() === "error" &&
      entry.location().url === expectedFeedFailureUrl &&
      entry.text() ===
        "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
    ) {
      expectedFeedFailures++;
      return;
    }
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

  const glmManifest = loadGlmTargetManifest();
  // Saving preferences and managing feeds require a recent login.
  await page.context().clearCookies();
  await page.goto("/auth/login?next=%2Fapp%2Fsearch");
  await page.getByLabel("邮箱", { exact: true }).fill(accountState.email);
  await page.getByLabel("密码", { exact: true }).fill(accountState.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/search$/);
  accountState.authenticatedAt = Date.now();
  await waitForWorkbenchReady(page, "/app/search");
  await expect(page.getByTestId("search-command")).toBeVisible();

  const workspaceResponse = await page.request.get("/api/v1/workspaces");
  expect(workspaceResponse.ok(), await workspaceResponse.text()).toBe(true);
  const workspaceId = (
    (await workspaceResponse.json()) as { workspaces: Array<{ id: string }> }
  ).workspaces[0]?.id;
  if (!workspaceId) throw new Error("Search audit account has no Workspace.");
  const spacesResponse = await page.request.get(
    `/api/v1/workspaces/${workspaceId}/spaces`,
  );
  expect(spacesResponse.ok(), await spacesResponse.text()).toBe(true);
  const spaceId = (
    (await spacesResponse.json()) as { spaces: Array<{ id: string }> }
  ).spaces[0]?.id;
  if (!spaceId) throw new Error("Search audit account has no Space.");

  const headers = await csrfHeaders(page);
  const marker = `B2-${Date.now()}`;
  const goalId = randomUUID();
  const phaseId = randomUUID();
  const goal = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/goals`,
    {
      data: {
        description: "Search Gate 1 real-data goal",
        desired_outcome: "Verify grouped retrieval without mock data",
        goal_id: goalId,
        phases: [
          {
            acceptance_criteria: ["Search result is permission filtered"],
            description: "Real Search route acceptance",
            estimated_minutes: 45,
            id: phaseId,
            position: 0,
            title: `${marker} phase`,
          },
        ],
        plan_id: randomUUID(),
        plan_version_id: randomUUID(),
        target_date: null,
        title: `${marker} goal`,
        weekly_minutes: 120,
      },
      headers,
    },
  );
  expect(goal.status(), await goal.text()).toBe(201);
  const taskResponse = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/tasks`,
    {
      data: {
        description: "Search result keyboard and preview acceptance",
        due_at: null,
        estimated_minutes: 30,
        goal_id: goalId,
        id: randomUUID(),
        phase_id: phaseId,
        priority: 2,
        title: `${marker} task`,
      },
      headers,
    },
  );
  expect(taskResponse.status(), await taskResponse.text()).toBe(201);
  const noteResponse = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/notes`,
    {
      data: {
        id: randomUUID(),
        markdown_body: `Real searchable content for ${marker}`,
        task_id: null,
        title: `${marker} note`,
      },
      headers,
    },
  );
  expect(noteResponse.status(), await noteResponse.text()).toBe(201);

  const searchInput = page.getByRole("searchbox", { name: "统一搜索" });
  const resultsPane = page.getByTestId("search-results");
  await searchInput.fill(marker);
  await searchInput.press("Enter");
  await expect(
    resultsPane.getByText(`${marker} goal`, { exact: true }),
  ).toBeVisible();
  await expect(
    resultsPane.getByText(`${marker} task`, { exact: true }),
  ).toBeVisible();
  await expect(
    resultsPane.getByText(`${marker} note`, { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(
    resultsPane.getByText(`${marker} note`, { exact: true }),
  ).toBeVisible();
  await expect(
    resultsPane.getByText(`${marker} task`, { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await page.getByRole("button", { name: "私有", exact: true }).click();
  await expect(
    resultsPane.getByText(`${marker} goal`, { exact: true }),
  ).toBeVisible();

  const resultRows = page.locator("[data-search-result]");
  await expect(resultRows).toHaveCount(3);
  await resultRows.first().focus();
  await resultRows.first().press("ArrowDown");
  await expect(resultRows.nth(1)).toBeFocused();
  await expect(page.getByTestId("search-preview").locator("h2")).toHaveText(
    new RegExp(marker),
  );

  await searchInput.fill(`missing-${marker}`);
  await searchInput.press("Enter");
  await expect(page.getByRole("heading", { name: /没有匹配/ })).toBeVisible();
  await expect(
    page.locator('[data-workbench-primary="true"]:visible'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "清除筛选" }).click();

  await page.getByRole("tab", { name: /通知/ }).click();
  await page.getByRole("button", { name: "保存偏好" }).click();
  await expect(page.getByText(/通知偏好已保存/)).toBeVisible();

  await page.getByRole("tab", { name: "日历" }).click();
  const createFeed = page.getByRole("button", { name: "创建订阅" });
  await createFeed.click();
  const createSheet = page.getByRole("dialog", { name: "创建只读日历订阅" });
  await expect(createSheet.getByLabel("订阅名称")).toBeFocused();
  const feedName = `${marker} dates`;
  await createSheet.getByLabel("订阅名称").fill(feedName);
  await createSheet.getByRole("button", { name: "创建并显示地址" }).click();
  await expect(
    createSheet.getByText("一次性 URL", { exact: true }),
  ).toBeVisible();
  await createSheet.getByRole("button", { name: "已保存，关闭" }).click();
  await expect(createSheet).toHaveCount(0);
  await expect(createFeed).toBeFocused();

  const feedRow = page.locator("article").filter({ hasText: feedName });
  await feedRow.getByRole("button", { name: "撤销" }).click();
  const revokeSheet = page.getByRole("dialog", {
    name: new RegExp(`撤销.*${marker}`),
  });
  const revokeButton = revokeSheet.getByRole("button", {
    name: "永久撤销 URL",
  });
  await expect(revokeButton).toBeDisabled();
  await revokeSheet.getByLabel("输入 REVOKE 确认").fill("REVOKE");
  await expect(revokeButton).toBeEnabled();
  const feedListUrl = `**/api/v1/workspaces/${workspaceId}/calendar-feeds`;
  expectedFeedFailureUrl = new URL(
    `/api/v1/workspaces/${workspaceId}/calendar-feeds`,
    page.url(),
  ).href;
  await page.route(feedListUrl, (route) =>
    route.fulfill({
      status: 503,
      json: {
        code: "SERVICE_UNAVAILABLE",
        message: "Synthetic read failure",
        request_id: "m06-calendar-refresh",
        retryable: true,
      },
    }),
  );
  await revokeButton.click();
  await expect(revokeSheet).toHaveCount(0);
  await expect(feedRow.getByText("已撤销", { exact: true })).toBeVisible();
  await expect(page.getByText(/日历订阅已撤销，但列表尚未刷新/)).toBeVisible();
  expect(expectedFeedFailures).toBe(1);
  await expect(
    feedRow.getByRole("button", { name: "撤销", exact: true }),
  ).toHaveCount(0);
  await page.unroute(feedListUrl);
  await page.getByRole("button", { name: "重试当前操作", exact: true }).click();
  await expect(
    page.getByText("当前工作区的通知与日历已更新。", { exact: true }),
  ).toBeVisible();
  await expect(feedRow.getByText("已撤销", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "搜索", exact: true }).click();
  await searchInput.fill(marker);
  await searchInput.press("Enter");
  await expect(
    resultsPane.getByText(`${marker} note`, { exact: true }),
  ).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.getByText(/离线时只搜索本机/)).toBeVisible();
  await expect(page.getByLabel("本机缓存口令")).toBeVisible();
  await expect(
    page.getByTestId("workbench-master").getByRole("button", {
      exact: true,
      name: "私有",
    }),
  ).toBeDisabled();
  await page.context().setOffline(false);
  await expect(page.getByText(/离线时只搜索本机/)).toHaveCount(0);

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/search");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/search", viewport);
    await assertGlmRouteRegions(page, glmManifest, "/app/search");
    await assertGlmShellGeometry(page, glmManifest);
    await assertGlmWorkbenchGeometry(page, glmManifest);
    await assertGlmPrimaryContract(page, glmManifest, "/app/search");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(
      axe.violations,
      `Search ${viewport.label} must have no automated WCAG violations`,
    ).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/search", viewport);
    await assertPrimaryActionContract(page, "/app/search", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/search", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });

  expect(
    runtimeProblems,
    "Search must not emit browser warnings or errors",
  ).toEqual([]);
});
