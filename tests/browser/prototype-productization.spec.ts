import type { Page } from "@playwright/test";

import { e2eBaseUrl } from "./e2e-environment";
import { expect, test } from "./fixtures";
import {
  assertGlmShellGeometry,
  assertGlmWorkbenchGeometry,
  isGlmTargetSourceAvailable,
  loadGlmTargetManifest,
  validateGlmManifestStructure,
  validateGlmTargetAssets,
} from "./glm-conformance";
import {
  APP_PRODUCT_ROUTES,
  PUBLIC_FLOW_ROUTES,
} from "../../apps/web/src/features/productization/prototype-view-manifest";

async function openAiDraftForm(page: Page) {
  await page.getByRole("button", { name: "创建结构化草稿" }).click();
}

test.describe("prototype productization", () => {
  test("freezes every formal route against the approved GLM design contract", () => {
    const manifest = loadGlmTargetManifest();
    const errors = validateGlmManifestStructure(manifest, {
      appRoutes: APP_PRODUCT_ROUTES,
      publicRoutes: PUBLIC_FLOW_ROUTES,
    });

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("verifies approved GLM target files and SHA-256 when the isolated source is available", () => {
    const manifest = loadGlmTargetManifest();
    test.skip(
      !isGlmTargetSourceAvailable(manifest),
      "Set LOGION_GLM_TARGET_ROOT to the approved isolated GLM workspace for the visual evidence gate.",
    );

    const errors = validateGlmTargetAssets(manifest);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("shared Shell and Today Workbench honor frozen desktop geometry", async ({
    page,
  }) => {
    const manifest = loadGlmTargetManifest();
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/app/today", { waitUntil: "domcontentloaded" });

    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
  });

  test("rejects missing routes, targets, deviation records and tampered evidence", () => {
    const manifest = loadGlmTargetManifest();
    const broken = structuredClone(manifest);
    broken.routes = broken.routes.filter(
      (contract) => contract.route !== "/app/help",
    );
    const today = broken.routes.find(
      (contract) => contract.route === "/app/today",
    );
    const records = broken.routes.find(
      (contract) => contract.route === "/app/records",
    );
    if (!today || !records)
      throw new Error("Required GLM route fixture missing");
    today.targets = [];
    records.deviation = undefined as never;

    const structureErrors = validateGlmManifestStructure(broken, {
      appRoutes: APP_PRODUCT_ROUTES,
      publicRoutes: PUBLIC_FLOW_ROUTES,
    });
    expect(
      structureErrors.some((error) =>
        error.startsWith("app route coverage differs"),
      ),
    ).toBe(true);
    expect(structureErrors).toContain("route /app/today has no GLM Target");
    expect(structureErrors).toContain(
      "route /app/records has no deviation record or reason",
    );

    test.skip(
      !isGlmTargetSourceAvailable(manifest),
      "Set LOGION_GLM_TARGET_ROOT to run the evidence tamper check.",
    );
    const tampered = structuredClone(manifest);
    const target = tampered.assets["app_today-1440x900.png"];
    if (!target) throw new Error("Required GLM target fixture missing");
    target.sha256 = "0".repeat(64);
    expect(
      validateGlmTargetAssets(tampered).some((error) =>
        error.includes("app_today-1440x900.png SHA-256 mismatch"),
      ),
    ).toBe(true);
  });

  test("formal public routing keeps callback and does not invent a passkey page", async ({
    browser,
  }) => {
    const publicPage = await browser.newPage();
    try {
      await publicPage.goto(new URL("/auth/callback", e2eBaseUrl).href);
      await expect(publicPage).toHaveURL(
        /\/(?:auth\/callback|onboarding|app\/today)$/,
      );

      const response = await publicPage.goto(
        new URL("/auth/passkey", e2eBaseUrl).href,
      );
      expect(response?.status()).toBe(404);
    } finally {
      await publicPage.close();
    }
  });

  test("learning workbenches distinguish a locked Vault from empty data", async ({
    page,
  }) => {
    await page.goto("/app/today");
    await expect(page.locator(".app-shell-frame")).toBeVisible();
    const unlockedVaultButton = page.getByRole("button", {
      name: "本地资料已解锁",
      exact: true,
    });
    if (await unlockedVaultButton.isVisible()) {
      await unlockedVaultButton.click();
      const vaultDialog = page.getByRole("dialog", { name: "本地资料保护" });
      await vaultDialog.getByRole("button", { name: "立即锁定" }).click();
      await expect(
        vaultDialog.getByText("本地资料已锁定", { exact: true }),
      ).toBeVisible();
      await vaultDialog.getByRole("button", { name: "关闭" }).click();
    }

    for (const [route, title, lockedTitle] of [
      ["/app/planning", "目标与路线", "本地规划资料已锁定"],
      ["/app/review", "把“看过”变成真正能回忆", "先解锁本地资料"],
      ["/app/exam", "围绕最近考试推进覆盖与模考", "先解锁本地资料"],
      ["/app/records", "资料与笔记", "需要解锁本地资料"],
      ["/app/self-study", "把想法推进为可验证成果", "先解锁本地资料"],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(page.getByText(lockedTitle, { exact: true })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /当前 Space.*(?:没有|还是空)/ }),
      ).toHaveCount(0);
    }
  });

  test("knowledge and records views expose their real-data controls", async ({
    accountState,
    page,
  }) => {
    await page.goto("/app/review#knowledge-graph");
    await expect(page.getByRole("button", { name: "图谱" })).toBeVisible();
    await page.getByRole("button", { name: "列表与掌握确认" }).click();
    await expect(
      page.getByRole("heading", { name: "先建立知识图谱" }),
    ).toBeVisible();

    await page.goto("/app/records");
    await expect(
      page.getByRole("searchbox", { name: "搜索笔记、资料或附件" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "记录类型" }),
    ).toBeVisible();
    const unlockRecords = page.getByRole("button", {
      name: "解锁资料",
      exact: true,
    });
    if (await unlockRecords.first().isVisible()) {
      await unlockRecords.first().click();
      const unlockSheet = page.getByRole("dialog", { name: "解锁本地资料" });
      await unlockSheet.getByLabel("本地口令").fill(accountState.password);
      await unlockSheet.getByRole("button", { name: "解锁资料" }).click();
      await expect(unlockSheet).toHaveCount(0);
    }
    const noteRows = page
      .getByTestId("records-tree")
      .getByRole("button", { name: /更新于/ });
    if ((await noteRows.count()) === 0) {
      await page.getByRole("button", { name: "新建笔记" }).click();
      const newNoteSheet = page.getByRole("dialog", {
        name: "新建 Markdown 笔记",
      });
      await newNoteSheet
        .getByLabel("标题")
        .fill(`Prototype reachability ${Date.now()}`);
      await newNoteSheet.getByRole("button", { name: "创建笔记" }).click();
      await expect(newNoteSheet).toHaveCount(0);
    }
    await noteRows.first().click();
    await expect(
      page.getByRole("link", { name: "打开同步中心" }),
    ).toHaveAttribute("href", "/app/sync");
  });

  test("research, collaboration and AI retain real source and permission gates", async ({
    page,
  }) => {
    await page.goto("/app/research");
    await expect(page.getByPlaceholder("论文来源 URL（可选）")).toHaveAttribute(
      "type",
      "url",
    );
    await page.getByRole("tab", { name: /实验与指标/ }).click();
    await expect(
      page.getByRole("heading", { name: "实验与指标" }),
    ).toBeVisible();

    await page.goto("/app/collaboration");
    await expect(
      page.getByRole("heading", {
        name: /先解锁本地资料|还缺少工作台上下文/,
      }),
    ).toBeVisible();

    await page.goto("/app/ai");
    await openAiDraftForm(page);
    await expect(
      page.getByLabel("我已明确选择并核对上述发送来源与内容范围"),
    ).toBeVisible();
  });

  test("system workbenches expose real diagnostics and explicit integration boundaries", async ({
    page,
  }) => {
    await page.goto("/app/ai");
    const aiNavigation = page.getByRole("navigation", {
      name: "AI 路由中心分区",
    });
    await expect(
      aiNavigation.getByRole("tab", { name: "Draft" }),
    ).toBeVisible();
    await expect(
      aiNavigation.getByRole("tab", { name: "Provider" }),
    ).toBeVisible();
    for (const tab of await aiNavigation.getByRole("tab").all()) {
      const controls = await tab.getAttribute("aria-controls");
      expect(controls).toBeTruthy();
      await expect(page.locator(`#${controls}`)).toHaveCount(1);
    }
    await openAiDraftForm(page);
    await expect(
      page.getByRole("button", { name: "预检发送范围与预算" }),
    ).toBeVisible();

    await page.goto("/app/sync");
    await expect(page.getByRole("heading", { name: "同步诊断" })).toBeVisible();
    await expect(
      page.getByRole("tablist", { name: "同步诊断视图" }),
    ).toBeVisible();
    await expect(page.getByTestId("sync-master")).toBeVisible();

    await page.goto("/app/security");
    const securityNavigation = page.getByRole("navigation", {
      name: "安全与数据主权",
    });
    await expect(
      securityNavigation.getByRole("link", { name: "审计时间线" }),
    ).toHaveAttribute("href", "/app/audit");

    await page.goto("/app/integrations");
    await expect(
      page.getByRole("heading", { name: "通用连接器与自动化" }),
    ).toBeVisible();
    await expect(
      page.getByText("以下能力需要独立的凭据存储、授权、审计与后台调度设计", {
        exact: false,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "打开通知中心" }).click();
    await expect(
      page.getByRole("dialog", { name: /通知中心|未读通知/ }),
    ).toBeVisible();
  });
});
