import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import {
  assertGlmPrimaryContract,
  assertGlmRouteRegions,
  loadGlmTargetManifest,
} from "./glm-conformance";
import {
  auditHorizontalOverflow,
  captureEvidenceScreenshot,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const manifest = loadGlmTargetManifest();

test.describe("formal auth and onboarding public flows", () => {
  test.describe.configure({ mode: "serial" });

  test("onboarding exposes its approved layout at all product viewports", async ({
    page,
  }) => {
    for (const viewport of WORKBENCH_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto("/onboarding");
      await expect(
        page.getByRole("heading", { name: "选择你的学习场景" }),
      ).toBeVisible();
      await assertGlmRouteRegions(page, manifest, "/onboarding");
      await assertGlmPrimaryContract(page, manifest, "/onboarding");
      const overflow = await auditHorizontalOverflow(page);
      expect(
        overflow.offenders,
        `/onboarding @ ${viewport.label} must not leak horizontally`,
      ).toEqual([]);
      expect(overflow.scrollWidth).toBe(overflow.clientWidth);
      await captureEvidenceScreenshot(page, "after", "/onboarding", viewport);
    }
  });

  test("completes the formal seven-step onboarding with real services", async ({
    accountState,
    page,
  }) => {
    test.setTimeout(120_000);
    const suffix = randomUUID().slice(0, 8);
    const vaultPassphrase =
      process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;

    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/onboarding");
    const selfPersona = page.getByRole("button", { name: /^学：/ });
    await selfPersona.click();
    await page.getByRole("button", { name: "继续", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "创建或选择工作区" }),
    ).toBeVisible();
    const workspaceSelect = page.getByLabel("已有工作区");
    await expect(workspaceSelect).toBeEnabled();
    const workspaceCount = await workspaceSelect
      .locator("option:not([value=''])")
      .count();
    if (workspaceCount >= 10) {
      // The API's formal Workspace quota is 10; use the selection path when
      // this long-lived real account has already reached that limit.
      await workspaceSelect.selectOption({ index: 1 });
    } else {
      await page.getByLabel("工作区名称").fill(`Auth 验收 ${suffix}`);
      await page.getByRole("button", { name: "创建并选择" }).click();
    }
    await expect(workspaceSelect).not.toHaveValue("");
    await page.getByRole("button", { name: "上一步" }).click();
    await expect(selfPersona).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    const continueWithWorkspace = page.getByRole("button", {
      name: "继续",
      exact: true,
    });
    await expect(continueWithWorkspace).toBeEnabled();
    await continueWithWorkspace.click();

    await expect(
      page.getByRole("heading", { name: "创建或选择空间" }),
    ).toBeVisible();
    await page.getByLabel("空间名称").fill(`私有资料 ${suffix}`);
    await page.getByRole("button", { name: "创建并选择" }).click();
    await expect(page.getByLabel("已有空间")).not.toHaveValue("");
    await page.getByRole("button", { name: "继续", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "设置本机数据口令" }),
    ).toBeVisible();
    await page.getByLabel("本机口令", { exact: true }).fill(vaultPassphrase);
    await page
      .getByLabel("再次输入本机口令", { exact: true })
      .fill(vaultPassphrase);
    await page.getByRole("button", { name: "设置并继续" }).click();

    await expect(
      page.getByRole("heading", { name: "从模板库挑一个起点" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "跳过并继续" }).click();

    await expect(
      page.getByRole("heading", { name: "设定今日目标" }),
    ).toBeVisible();
    await page.getByLabel("目标名称").fill(`完成 Auth 验收 ${suffix}`);
    await page
      .getByLabel("今天如何判断已完成？")
      .fill("完成七步真实流程并进入今日工作台");
    await page.getByLabel("每周计划投入（分钟）").fill("90");
    await page.getByRole("button", { name: "创建目标并继续" }).click();

    await expect(
      page.getByRole("heading", { name: "开始使用 Logion" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "上一步" })).toBeDisabled();
    await page.getByRole("button", { name: "进入 Logion" }).click();
    await expect(page).toHaveURL(/\/app\/today$/);
    await waitForWorkbenchReady(page, "/app/today");

    await page.goto("/auth/callback");
    await expect(page).toHaveURL(/\/app\/today$/);
  });
});
