import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  if (!csrf) throw new Error("Templates real-flow audit has no CSRF cookie.");
  return {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": csrf,
  };
}

test("Templates completes real version, install, import and share workflows", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright")
      return;
    if (["error", "warning"].includes(entry.type())) {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    runtimeProblems.push(`pageerror: ${error.message}`),
  );

  const marker = `TEMPLATE-${Date.now()}`;
  const manifest = loadGlmTargetManifest();
  await page.goto("/app/templates", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/templates");

  const officialTemplates = [
    "每日工作台 · 7 天执行循环",
    "研究项目 · 问题到证据",
  ];
  for (const officialName of officialTemplates) {
    const officialRow = page
      .getByTestId("templates-list")
      .getByRole("button")
      .filter({ hasText: officialName })
      .first();
    await expect(officialRow).toBeVisible();
    await officialRow.click();
    await expect(
      page
        .getByTestId("templates-source-details")
        .getByText("Logion 官方目录", {
          exact: true,
        }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("note")
        .filter({ hasText: "官方模板不可编辑、分享或撤销" }),
    ).toBeVisible();
    const officialPrimary = page.locator(
      '[data-workbench-primary="true"]:visible',
    );
    await expect(officialPrimary).toHaveText(/安装独立副本/);
    await expect(
      page.getByRole("button", { name: "分享当前路线" }),
    ).toHaveCount(0);
    for (const createControl of await page
      .locator('[data-template-sheet="create"]')
      .all()) {
      await expect(createControl).toBeDisabled();
    }
    await officialPrimary.click();
    const officialInstallSheet = page.getByRole("dialog", {
      name: "安装独立模板副本",
    });
    await expect(
      officialInstallSheet.getByText("不会覆盖现有内容"),
    ).toBeVisible();
    const startDate = officialInstallSheet.getByLabel("安装起始日期");
    if (await startDate.count()) await startDate.fill("2027-01-05");
    await officialInstallSheet
      .getByRole("button", { name: "确认安装" })
      .click();
    await expect(officialInstallSheet).toHaveCount(0);
    await expect(page.getByText(/模板已安装为独立计划/)).toBeVisible();
  }

  const workspaceResponse = await page.request.get("/api/v1/workspaces");
  expect(workspaceResponse.ok(), await workspaceResponse.text()).toBe(true);
  const workspaceId = (
    (await workspaceResponse.json()) as { workspaces: Array<{ id: string }> }
  ).workspaces[0]?.id;
  if (!workspaceId)
    throw new Error("Templates audit account has no Workspace.");

  const spacesResponse = await page.request.get(
    `/api/v1/workspaces/${workspaceId}/spaces`,
  );
  expect(spacesResponse.ok(), await spacesResponse.text()).toBe(true);
  const spaceId = (
    (await spacesResponse.json()) as { spaces: Array<{ id: string }> }
  ).spaces[0]?.id;
  if (!spaceId) throw new Error("Templates audit account has no Space.");

  const headers = await csrfHeaders(page);
  const goalId = randomUUID();
  const phaseId = randomUUID();
  const goalResponse = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/goals`,
    {
      data: {
        description: "Templates real-flow source goal",
        desired_outcome:
          "Create and install a versioned independent template copy",
        goal_id: goalId,
        phases: [
          {
            acceptance_criteria: [
              "The template remains immutable after installation.",
            ],
            description: "Template source phase",
            estimated_minutes: 60,
            id: phaseId,
            position: 0,
            title: `${marker} phase`,
          },
        ],
        plan_id: randomUUID(),
        plan_version_id: randomUUID(),
        target_date: null,
        title: `${marker} source goal`,
        weekly_minutes: 120,
      },
      headers,
    },
  );
  expect(goalResponse.status(), await goalResponse.text()).toBe(201);

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/templates");
  await expect(page.getByTestId("templates-category-master")).toBeVisible();
  await page.getByRole("button", { name: /仅自己的模板/ }).click();
  const tenantTemplate = page
    .getByTestId("templates-list")
    .getByRole("button")
    .first();
  await expect(tenantTemplate).toBeVisible();
  await tenantTemplate.click();

  const createTrigger = page.locator('[data-template-sheet="create"]').first();
  await expect(createTrigger).toBeEnabled();
  await createTrigger.click();
  const createSheet = page.getByRole("dialog", { name: "创建模板版本" });
  await expect(createSheet.getByLabel("模板名称")).toBeFocused();
  await expect(createSheet.getByLabel("来源目标")).toContainText(marker);
  await createSheet.getByLabel("来源目标").selectOption(goalId);
  await createSheet.getByLabel("模板名称").fill(`${marker} reusable template`);
  await createSheet
    .getByLabel("说明", { exact: true })
    .fill("A real immutable template version.");
  await createSheet.getByLabel("作者显示名").fill("Logion E2E");
  await createSheet.getByLabel("许可证").fill("CC-BY-4.0");
  await createSheet.getByLabel("适用人群").fill("self-study,research");
  await createSheet.getByRole("button", { name: "创建版本" }).click();
  await expect(createSheet).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: `${marker} reusable template`,
      exact: true,
    }),
  ).toBeVisible();

  const primary = page.locator('[data-workbench-primary="true"]:visible');
  await expect(primary).toHaveText(/安装独立副本/);
  await primary.click();
  const installSheet = page.getByRole("dialog", {
    name: "安装独立模板副本",
  });
  await expect(installSheet.getByText("目标 Space")).toBeVisible();
  await installSheet.getByRole("button", { name: "确认安装" }).click();
  await expect(installSheet).toHaveCount(0);
  await expect(page.getByText(/模板已安装为独立计划/)).toBeVisible();

  const goalsAfterInstall = await page.request.get(
    `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/goals`,
  );
  expect(goalsAfterInstall.ok(), await goalsAfterInstall.text()).toBe(true);
  expect(
    ((await goalsAfterInstall.json()) as { goals: unknown[] }).goals.length,
  ).toBeGreaterThan(1);

  await page.getByRole("button", { name: "更多模板操作" }).click();
  await page.getByRole("menuitem", { name: "导入模板包" }).click();
  const importSheet = page.getByRole("dialog", { name: "导入模板包" });
  await importSheet
    .getByLabel("结构化模板包（JSON，最大 1 MB）")
    .setInputFiles({
      buffer: Buffer.from("{invalid", "utf8"),
      mimeType: "application/json",
      name: `${marker}-invalid.json`,
    });
  await importSheet.getByRole("button", { name: "校验并导入" }).click();
  await expect(
    importSheet.getByText("模板不是有效 JSON。", { exact: true }),
  ).toBeVisible();

  const example = JSON.parse(
    readFileSync(
      resolve("examples", "templates", "ai-presemester-47-day.template.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const importedName = `${marker} imported template`;
  const validPackage = {
    ...example,
    name: importedName,
    package_id: randomUUID(),
    template_key: randomUUID(),
  };
  await importSheet
    .getByLabel("结构化模板包（JSON，最大 1 MB）")
    .setInputFiles({
      buffer: Buffer.from(JSON.stringify(validPackage), "utf8"),
      mimeType: "application/json",
      name: `${marker}-valid.json`,
    });
  await importSheet.getByRole("button", { name: "校验并导入" }).click();
  await expect(importSheet).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: importedName, exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "创建只读分享" }).click();
  const shareSheet = page.getByRole("dialog", { name: "创建只读分享" });
  await expect(shareSheet.getByLabel("分享标题")).toBeFocused();
  await shareSheet.getByLabel("来源目标").selectOption(goalId);
  const shareTitle = `${marker} read-only snapshot`;
  await shareSheet.getByLabel("分享标题").fill(shareTitle);
  await shareSheet.getByLabel("有效天数").fill("7");
  await shareSheet.getByRole("button", { name: "创建只读链接" }).click();
  await expect(shareSheet).toHaveCount(0);
  const tokenLink = page.getByRole("link", { name: "打开只读分享" });
  await expect(tokenLink).toBeVisible();
  const tokenHref = await tokenLink.getAttribute("href");
  expect(tokenHref).toMatch(/^\/shares\/[A-Za-z0-9_-]{32,128}$/);
  await page.goto("/app/templates", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/templates");
  await expect(page.getByRole("link", { name: "打开只读分享" })).toHaveCount(0);
  const shareRow = page.locator("li").filter({ hasText: shareTitle });
  await expect(shareRow).toBeVisible();
  await shareRow.getByRole("button", { name: "撤销" }).click();
  const revokeSheet = page.getByRole("dialog", { name: "撤销只读分享" });
  await revokeSheet.getByRole("button", { name: "确认撤销" }).click();
  await expect(revokeSheet).toHaveCount(0);
  await expect(
    page.getByText("分享已撤销，原链接立即失效。", { exact: true }),
  ).toBeVisible();

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/templates");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/templates", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/templates");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/templates");
    await assertPrimaryActionContract(page, "/app/templates", viewport);
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(
      axe.violations,
      `Templates ${viewport.label} must have no WCAG violations`,
    ).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/templates", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/templates", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(
    runtimeProblems,
    "Templates must not emit browser warnings or errors",
  ).toEqual([]);
});
