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
  assertWorkbenchViewportFill,
  captureEvidenceScreenshot,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function csrfHeaders(page: Page) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )?.value;
  if (!csrf)
    throw new Error("Collaboration real-flow audit has no CSRF cookie.");
  return {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": csrf,
  };
}

async function ensureSharedSpace(page: Page) {
  const workspaceResponse = await page.request.get("/api/v1/workspaces");
  expect(workspaceResponse.ok(), await workspaceResponse.text()).toBe(true);
  const workspaceId = (
    (await workspaceResponse.json()) as { workspaces: Array<{ id: string }> }
  ).workspaces[0]?.id;
  if (!workspaceId)
    throw new Error("Collaboration audit account has no Workspace.");

  const spacesResponse = await page.request.get(
    `/api/v1/workspaces/${workspaceId}/spaces`,
  );
  expect(spacesResponse.ok(), await spacesResponse.text()).toBe(true);
  const spaces = (await spacesResponse.json()) as {
    spaces: Array<{ id: string; visibility: "private" | "shared" }>;
  };
  const spaceName = `Collaboration E2E ${Date.now()}`;
  const created = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces`,
    {
      data: {
        name: spaceName,
        visibility: "shared",
      },
      headers: await csrfHeaders(page),
    },
  );
  expect(created.status(), await created.text()).toBe(201);
  const payload = (await created.json()) as { id: string };
  return { spaceId: payload.id, spaceName, workspaceId };
}

test("Collaboration completes shared review, feedback and immutable snapshot workflow", async ({
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
    if (["error", "warning"].includes(entry.type())) {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    runtimeProblems.push(`pageerror: ${error.message}`),
  );

  await page.goto("/app/collaboration", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/collaboration");
  const { spaceName } = await ensureSharedSpace(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/collaboration");

  const spaceSelect = page.getByRole("combobox", { name: "选择共享 Space" });
  await expect(spaceSelect).toBeEnabled();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await spaceSelect.click();
    await page.getByRole("option", { name: spaceName, exact: true }).click();
    if ((await spaceSelect.textContent())?.trim() === spaceName) break;
    await page.waitForTimeout(100);
  }
  await expect(spaceSelect).toHaveText(spaceName);

  const unlock = page
    .getByRole("button", { exact: true, name: "解锁资料" })
    .first();
  if (await unlock.isVisible()) {
    await unlock.click();
    const sheet = page.getByRole("dialog", { name: "解锁共享审阅资料" });
    await expect(sheet.getByLabel("本地口令")).toBeFocused();
    await sheet.getByLabel("本地口令").fill(vaultPassphrase);
    await sheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(sheet).toHaveCount(0);
  }

  const queue = page.getByTestId("collaboration-queue");
  await expect(queue).toBeVisible();
  const marker = `Collaboration-${Date.now()}`;
  const rubricTitle = `${marker} 评审标准`;
  const reviewTitle = `${marker} 研究提交`;
  const feedbackText = `${marker} 反馈请补充边界条件`;

  await queue.getByRole("button", { name: "创建 Rubric", exact: true }).click();
  const rubricSheet = page.getByRole("dialog", { name: "创建 Rubric" });
  await rubricSheet.getByLabel("Rubric 名称").fill(rubricTitle);
  await rubricSheet.getByLabel("验收标准").fill("说明证据来源\n给出下一步动作");
  await rubricSheet.getByRole("button", { name: "创建 Rubric" }).click();
  await expect(rubricSheet).toHaveCount(0);
  await expect(
    queue.getByRole("button", { name: "创建 Rubric", exact: true }),
  ).toBeEnabled();

  await page.locator('[data-workbench-primary="true"]:visible').click();
  const reviewSheet = page.getByRole("dialog", { name: "发起审阅" });
  await reviewSheet
    .getByLabel("审阅 Rubric")
    .selectOption({ label: rubricTitle });
  await reviewSheet.getByLabel("审阅对象（仅共享内容）").fill(reviewTitle);
  await reviewSheet.getByLabel("提交摘要").fill("请确认共享证据链和后续动作。");
  await reviewSheet.getByRole("button", { name: "发起审阅" }).click();
  await expect(reviewSheet).toHaveCount(0);

  const reviewRow = queue.getByRole("button", {
    name: new RegExp(reviewTitle),
  });
  await expect(reviewRow).toBeVisible();
  await reviewRow.click();
  await expect(page.getByTestId("collaboration-rubric")).toContainText(
    rubricTitle,
  );

  await page.locator('[data-workbench-primary="true"]:visible').click();
  const feedbackSheet = page.getByRole("dialog", { name: "提交反馈" });
  await feedbackSheet.getByLabel("反馈").fill(feedbackText);
  await feedbackSheet.getByLabel("建议动作（可选）").fill("补充高负载测试。");
  await feedbackSheet.getByRole("button", { name: "提交反馈" }).click();
  await expect(feedbackSheet).toHaveCount(0);
  await expect(page.getByTestId("collaboration-feedback")).toContainText(
    feedbackText,
  );

  await page.getByRole("button", { name: "审阅操作" }).click();
  await page.getByRole("menuitem", { name: "发布不可变快照" }).click();
  const snapshotSheet = page.getByRole("dialog", {
    name: "发布不可变报告快照",
  });
  await snapshotSheet
    .getByLabel("只读报告摘要")
    .fill("评审完成，证据链可追溯。");
  await snapshotSheet.getByLabel("确认短语").fill("NOPE");
  await snapshotSheet.getByRole("button", { name: "发布不可变快照" }).click();
  await expect(snapshotSheet).toContainText("请输入确认短语 PUBLISH");
  await snapshotSheet.getByLabel("确认短语").fill("PUBLISH");
  await snapshotSheet.getByRole("button", { name: "发布不可变快照" }).click();
  await expect(snapshotSheet).toHaveCount(0);
  await page.getByRole("tab", { name: "报告快照" }).click();
  await expect(page.getByTestId("collaboration-snapshot")).toContainText(
    "评审完成，证据链可追溯。",
  );

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/collaboration");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/collaboration", viewport);
    await assertWorkbenchViewportFill(page, "/app/collaboration", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/collaboration");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/collaboration");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Collaboration ${viewport.label} Axe`).toEqual([]);
    await captureEvidenceScreenshot(
      page,
      "after",
      "/app/collaboration",
      viewport,
    );
    await assertPrimaryActionContract(page, "/app/collaboration", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/collaboration", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(
    runtimeProblems,
    "Collaboration must not emit browser warnings or errors",
  ).toEqual([]);
});
