import { randomUUID } from "node:crypto";

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
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

  const glmManifest = loadGlmTargetManifest();
  await page.goto("/app/search", { waitUntil: "domcontentloaded" });
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
  await revokeButton.click();
  await expect(revokeSheet).toHaveCount(0);
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
