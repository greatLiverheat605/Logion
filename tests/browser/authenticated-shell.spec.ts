import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
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
  "/app/integrations",
  "/app/ai",
  "/app/spaces",
  "/app/settings",
  "/app/profile",
  "/app/help",
];
const responsiveViewports = [
  { height: 900, label: "desktop", width: 1440 },
  { height: 900, label: "1250", width: 1250 },
  { height: 844, label: "900", width: 900 },
  { height: 844, label: "720", width: 720 },
  { height: 844, label: "420", width: 420 },
  { height: 844, label: "390x844", width: 390 },
  { height: 640, label: "320x640", width: 320 },
] as const;

test.describe("authenticated shell", () => {
  test("workbenches have no WCAG violations or horizontal overflow", async ({
    page,
  }) => {
    test.setTimeout(120_000);

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

  test("all authenticated routes fit every product breakpoint", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    for (const viewport of responsiveViewports) {
      await page.setViewportSize(viewport);
      for (const route of authenticatedRoutes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("h1")).toBeVisible();
        const dimensions = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(
          dimensions.scrollWidth,
          `${route} must fit the ${viewport.label} viewport`,
        ).toBeLessThanOrEqual(dimensions.clientWidth);
      }
    }
  });

  test("theme preference persists across document navigation", async ({
    page,
  }) => {
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

  test("every authenticated route renders with complete light and dark tokens", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        localStorage.setItem("app-shell-theme", nextTheme);
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      for (const route of authenticatedRoutes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator("h1")).toBeVisible();
        const tokens = await page.evaluate(() => {
          const styles = getComputedStyle(document.documentElement);
          return [
            "--bg-app",
            "--bg-sidebar",
            "--bg-surface",
            "--text-primary",
            "--text-secondary",
            "--border",
            "--primary",
          ].map((name) => styles.getPropertyValue(name).trim());
        });
        expect(
          tokens.every((value) => value.length > 0),
          `${route} must resolve every ${theme} semantic token`,
        ).toBe(true);
      }
    }
  });

  test("command palette traps and restores keyboard focus", async ({
    page,
  }) => {
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

  test("global keyboard shortcuts and Escape restore their trigger focus", async ({
    page,
  }) => {
    await page.goto("/app/today");

    const commandButton = page.getByRole("button", {
      name: /搜索、导航或执行命令/,
    });
    await commandButton.focus();
    await page.keyboard.press("Control+K");
    await expect(
      page.getByRole("dialog", { name: "搜索、跳转与执行" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "搜索、跳转与执行" }),
    ).toHaveCount(0);
    await expect(commandButton).toBeFocused();

    const notificationButton = page.getByRole("button", {
      name: "打开通知中心",
    });
    await notificationButton.click();
    await expect(
      page.getByRole("dialog", { name: /通知中心|未读通知/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: /通知中心|未读通知/ }),
    ).toHaveCount(0);
    await expect(notificationButton).toBeFocused();
  });

  test("reduced motion removes non-essential motion on every authenticated route", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const route of authenticatedRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".app-shell-frame")).toBeVisible();
      await expect(page.locator("h1")).toBeVisible();

      const reducedMotionMatches = await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      expect(
        reducedMotionMatches,
        `${route} must run with reduced motion enabled`,
      ).toBe(true);

      const motionReport = await page
        .locator(".app-shell-frame, .app-shell-frame *")
        .evaluateAll((elements) => {
          const movingElements = elements.flatMap((element) => {
            const style = getComputedStyle(element);
            const hasAnimation =
              style.animationName !== "none" &&
              style.animationDuration !== "0s";
            const hasTransition =
              style.transitionDuration !== "0s" &&
              style.transitionProperty !== "none";
            if (!hasAnimation && !hasTransition) return [];

            return [
              {
                animationDuration: style.animationDuration,
                animationName: style.animationName,
                ariaLabel: element.getAttribute("aria-label"),
                className:
                  typeof element.className === "string"
                    ? element.className
                    : null,
                id: element.id || null,
                tagName: element.tagName.toLowerCase(),
                transitionDuration: style.transitionDuration,
                transitionProperty: style.transitionProperty,
              },
            ];
          });
          return {
            count: movingElements.length,
            elements: movingElements.slice(0, 50),
          };
        });
      expect(
        motionReport.count,
        `${route} must honor reduced motion: ${JSON.stringify(motionReport)}`,
      ).toBe(0);
    }
  });

  test("command palette opens the real capture workflow", async ({ page }) => {
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
