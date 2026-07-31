import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const email = process.env.LOGION_E2E_EMAIL;
const password = process.env.LOGION_E2E_PASSWORD;
const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const authenticatedRoutes = [
  "/app/today",
  "/app/planning",
  "/app/review",
  "/app/exam",
  "/app/templates",
  "/app/records",
  "/app/research",
  "/app/audit",
  "/app/self-study",
  "/app/collaboration",
  "/app/search",
  "/app/workspaces",
  "/app/security",
  "/app/sync",
  "/app/data",
  "/app/ai",
  "/app/spaces",
  "/app/settings",
  "/app/profile",
  "/app/help",
];

async function completeOnboardingIfNeeded(page: Page) {
  if (!page.url().endsWith("/onboarding")) return;
  await page.evaluate(async () => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("logion_csrf="))
      ?.slice("logion_csrf=".length);
    if (!csrf) throw new Error("Missing CSRF cookie");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = (await fetch("/api/v1/users/me/settings", {
        credentials: "same-origin",
      }).then((response) => response.json())) as {
        settings: Array<{ key: string; value: string; version: number }>;
      };
      const byKey = new Map(
        current.settings.map((setting) => [setting.key, setting]),
      );
      const updates = [];
      if (!byKey.has("persona")) {
        updates.push({
          key: "persona",
          value: '{"activePersonaId":"self","customPersonas":[]}',
          version: 0,
        });
      }
      const onboarding = byKey.get("onboarding_completed");
      if (onboarding?.value !== "true") {
        updates.push({
          key: "onboarding_completed",
          value: "true",
          version: onboarding?.version ?? 0,
        });
      }
      if (updates.length === 0) return;
      const saved = await fetch("/api/v1/users/me/settings", {
        body: JSON.stringify({ settings: updates }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "PUT",
      });
      if (saved.ok) return;
      if (saved.status !== 409)
        throw new Error(`Setting seed failed: ${saved.status}`);
    }
    throw new Error("Setting seed did not converge");
  });
  await page.goto("/app/today");
}

async function signIn(page: Page) {
  await page.goto("/auth/login");
  const submitButton = page.getByRole("button", {
    name: "登录",
    exact: true,
  });
  await expect(submitButton).toBeEnabled();
  await page.getByLabel("邮箱").fill(email ?? "");
  await page.getByLabel("密码").fill(password ?? "");
  await submitButton.click();
  await expect(page).toHaveURL(/\/(?:app(?:\/today)?|onboarding)$/);
  await completeOnboardingIfNeeded(page);
  await expect(page).toHaveURL(/\/app(?:\/today)?$/);
}

test.describe("authenticated shell", () => {
  test.skip(
    !email || !password,
    "Set LOGION_E2E_EMAIL and LOGION_E2E_PASSWORD to audit signed-in routes.",
  );

  test("workbenches have no WCAG violations or horizontal overflow", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await signIn(page);

    for (const route of authenticatedRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("h1")).toBeVisible();
      const hasOverflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(hasOverflow, `${route} must not overflow horizontally`).toBe(
        false,
      );
      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .analyze();
      expect(results.violations).toEqual([]);
    }
  });

  test("theme preference persists across document navigation", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/app/today");

    const root = page.locator("html");
    const currentTheme = await root.getAttribute("data-theme");
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    await page
      .getByRole("button", {
        name: currentTheme === "dark" ? "切换到浅色主题" : "切换到深色主题",
        exact: true,
      })
      .click();
    await expect(root).toHaveAttribute("data-theme", nextTheme);
    await page.goto("/app/planning", { waitUntil: "domcontentloaded" });
    await expect(root).toHaveAttribute("data-theme", nextTheme);
  });

  test("command palette traps and restores keyboard focus", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/app/today");

    const commandButton = page.getByRole("button", {
      name: /搜索、导航或执行命令/,
    });
    await commandButton.click();
    const commandDialog = page.getByRole("dialog", {
      name: "搜索、跳转与执行",
    });
    await expect(
      commandDialog.getByRole("textbox", { name: "搜索页面或命令" }),
    ).toBeFocused();
    await expect(
      commandDialog.getByRole("heading", { name: "学习", exact: true }),
    ).toBeVisible();
    await expect(
      commandDialog.getByRole("heading", { name: "系统", exact: true }),
    ).toBeVisible();
    await expect(
      commandDialog.getByRole("heading", { name: "创建", exact: true }),
    ).toBeVisible();
    for (let step = 0; step < 20; step += 1) {
      await page.keyboard.press("Tab");
      const focusRemainsInDialog = await page.evaluate(
        () => document.activeElement?.closest('[role="dialog"]') !== null,
      );
      expect(focusRemainsInDialog).toBe(true);
    }
    await commandDialog.getByRole("button", { name: "关闭" }).click();
    await expect(commandButton).toBeFocused();
  });

  test("command palette opens the real capture workflow", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/today");

    await page.getByRole("button", { name: /搜索、导航或执行命令/ }).click();
    const commandDialog = page.getByRole("dialog", {
      name: "搜索、跳转与执行",
    });
    await commandDialog.getByRole("button", { name: /快速捕获/ }).click();

    const captureDialog = page.getByRole("dialog", { name: "快速捕获" });
    await expect(
      captureDialog.getByText("先解锁本地资料", { exact: true }),
    ).toBeVisible();
  });

  test("operational tools expose real Vault gates and restore focus", async ({
    page,
  }) => {
    await signIn(page);

    const vaultButton = page.getByRole("button", {
      name: "本地资料已锁定",
      exact: true,
    });
    await vaultButton.click();
    const vaultDialog = page.getByRole("dialog", { name: "本地资料保护" });
    await expect(
      vaultDialog.getByText("本地资料已锁定", { exact: true }),
    ).toBeVisible();
    await expect(vaultDialog.getByLabel("本地口令")).toBeFocused();
    await vaultDialog.getByRole("button", { name: "关闭" }).click();
    await expect(vaultButton).toBeFocused();

    const captureButton = page.getByRole("button", {
      name: "打开快速捕获",
      exact: true,
    });
    await captureButton.click();
    const captureDialog = page.getByRole("dialog", { name: "快速捕获" });
    await expect(
      captureDialog.getByText("先解锁本地资料", { exact: true }),
    ).toBeVisible();
    await captureDialog.getByRole("button", { name: "关闭" }).click();
    await expect(captureButton).toBeFocused();

    const focusButton = page.getByRole("button", {
      name: "打开专注计时",
      exact: true,
    });
    await focusButton.click();
    const focusDialog = page.getByRole("dialog", { name: "专注计时" });
    await expect(
      focusDialog.getByText("先解锁本地资料", { exact: true }),
    ).toBeVisible();
    await focusDialog.getByRole("button", { name: "关闭" }).click();
    await expect(focusButton).toBeFocused();
  });

  test("device data clearing is explicit and scoped", async ({ page }) => {
    await signIn(page);
    await page.goto("/app/sync");

    await expect(
      page.getByText("服务器数据不会删除，其他设备不受影响。", {
        exact: false,
      }),
    ).toBeVisible();
    const clearButton = page.getByRole("button", {
      name: "清除此设备数据",
      exact: true,
    });
    await expect(clearButton).toBeDisabled();
    await page
      .getByLabel("输入 CLEAR THIS DEVICE 确认", { exact: true })
      .fill("CLEAR THIS DEVIC");
    await expect(clearButton).toBeDisabled();
  });
});
