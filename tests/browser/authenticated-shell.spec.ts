import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";
import {
  assertNoHorizontalOverflow,
  auditHorizontalOverflow,
  assertPrimaryActionContract,
  assertReducedMotion,
  captureEvidenceScreenshot,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
test.describe("M07 authenticated classic scrollbars", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`today and records fit three widths in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.evaluate(
        (value) => localStorage.setItem("app-shell-theme", value),
        theme,
      );
      const measurements: unknown[] = [];
      for (const width of [320, 375, 1440]) {
        await page.setViewportSize({ width, height: 640 });
        for (const route of ["/app/today", "/app/records"]) {
          await page.goto(route);
          await waitForWorkbenchReady(page, route);
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          const audit = await auditHorizontalOverflow(page);
          measurements.push({ route, width, theme, ...audit });
          expect(audit.offenders, JSON.stringify(audit)).toEqual([]);
          expect(audit.scrollWidth, JSON.stringify(audit)).toBe(
            audit.clientWidth,
          );
          const axe = await new AxeBuilder({ page })
            .withTags(wcagTags)
            .analyze();
          expect(axe.violations).toEqual([]);
          if (width < 720) {
            await page
              .getByRole("button", { name: "打开主导航", exact: true })
              .click();
            await expect(
              page.getByRole("complementary", { name: "主导航" }),
            ).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(
              page.getByRole("button", { name: "打开主导航", exact: true }),
            ).toBeFocused();
          }
          if (width === 320)
            await page.screenshot({
              path: testInfo.outputPath(route.replaceAll("/", "-") + ".png"),
            });
        }
      }
      await testInfo.attach("geometry", {
        body: JSON.stringify(measurements, null, 2),
        contentType: "application/json",
      });
    });
  }
});
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
const sampleRoutes = new Set(["/app/today", "/app/search", "/app/records"]);
const captureBefore = process.env.LOGION_E2E_CAPTURE_BEFORE === "true";

test.describe("authenticated shell", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1440, 320]) {
      test(`R04 persona accessible name and keyboard in ${theme} at ${width}`, async ({
        page,
      }, testInfo) => {
        await page.setViewportSize({
          width,
          height: width === 320 ? 568 : 900,
        });
        await page.evaluate((value) => {
          localStorage.setItem("app-shell-theme", value);
        }, theme);
        await page.goto("/app/today");
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (width === 320) {
          await page
            .getByRole("button", { name: "打开主导航", exact: true })
            .click();
        }
        const link = page.locator(".persona-indicator");
        await expect(link.locator("strong")).not.toHaveText("画像加载中");
        const label = (await link.locator("strong").innerText()).trim();
        const description = (await link.locator("small").innerText()).trim();
        await expect(link).toHaveAccessibleName(`${label} ${description}`);
        await expect(link).not.toHaveAttribute("aria-label");
        await page.locator(".app-nav-link").last().focus();
        await page.keyboard.press("Tab");
        await expect(link).toBeFocused();
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeInViewport();
        const axe = await new AxeBuilder({ page })
          .include(".persona-indicator")
          .withTags(wcagTags)
          .analyze();
        expect(axe.violations).toEqual([]);
        const nameCheck = await new AxeBuilder({ page })
          .include(".persona-indicator")
          .withRules(["label-content-name-mismatch"])
          .analyze();
        expect(nameCheck.violations).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath(`persona-${theme}-${width}.png`),
        });
        await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/app\/settings$/);
      });
    }
  }

  for (const theme of ["light", "dark"] as const) {
    test(`workbenches have no WCAG violations or horizontal overflow in ${theme}`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const viewport = WORKBENCH_VIEWPORTS[3];
      await page.setViewportSize(viewport);
      await page.evaluate((value) => {
        localStorage.setItem("app-shell-theme", value);
      }, theme);

      for (const route of authenticatedRoutes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await waitForWorkbenchReady(page, route);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await assertNoHorizontalOverflow(page, route, viewport);
        const results = await new AxeBuilder({ page })
          .withTags(wcagTags)
          .analyze();
        expect(results.violations).toEqual([]);
      }
    });
  }

  test("all authenticated routes fit every product breakpoint", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    for (const viewport of WORKBENCH_VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const route of authenticatedRoutes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await waitForWorkbenchReady(page, route);
        await assertNoHorizontalOverflow(page, route, viewport);
        await assertPrimaryActionContract(page, route, viewport);
        if (captureBefore && sampleRoutes.has(route)) {
          await captureEvidenceScreenshot(page, "before", route, viewport);
        }
      }
    }
  });

  test("Audit preserves its mobile primary contract and filter command bar", async ({
    page,
  }) => {
    const viewport = WORKBENCH_VIEWPORTS[0];
    await page.setViewportSize(viewport);
    await page.goto("/app/audit", { waitUntil: "domcontentloaded" });
    await waitForWorkbenchReady(page, "/app/audit");

    await assertPrimaryActionContract(page, "/app/audit", viewport);
    const primaryCount = await page
      .locator('[data-workbench-primary="true"]:visible')
      .count();
    if (primaryCount === 0) {
      await page.getByRole("button", { exact: true, name: "审计筛选" }).click();
      const filterCommandBar = page.getByTestId("audit-filters");
      await expect(filterCommandBar).toBeVisible();
      const searchbox = filterCommandBar.getByRole("searchbox", {
        name: "搜索事件",
      });
      await expect(searchbox).toBeVisible();
      await expect(searchbox).toBeEnabled();
    }
  });

  test("Audit event rows meet WCAG contrast requirements", async ({ page }) => {
    const viewport = WORKBENCH_VIEWPORTS[3];
    await page.setViewportSize(viewport);
    await page.goto("/app/audit", { waitUntil: "domcontentloaded" });
    await waitForWorkbenchReady(page, "/app/audit");

    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations).toEqual([]);
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
    const viewport = WORKBENCH_VIEWPORTS[3];
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });

    for (const route of authenticatedRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await waitForWorkbenchReady(page, route);
      await assertReducedMotion(page, route, viewport);
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

  test("capture saves consecutive notes, closes with visible feedback and restores focus", async ({
    page,
    accountState,
  }) => {
    await page
      .getByRole("button", { name: "本地资料已锁定", exact: true })
      .click();
    const vault = page.getByRole("dialog", { name: "本地资料保护" });
    await vault
      .getByLabel("本地口令", { exact: true })
      .fill(accountState.password);
    await vault.getByRole("button", { name: /解锁本地资料/ }).click();
    await expect(
      vault.getByText("本地资料已解锁", { exact: true }),
    ).toBeVisible();
    await vault.getByRole("button", { name: "关闭", exact: true }).click();
    const trigger = page.getByRole("button", {
      name: "打开快速捕获",
      exact: true,
    });
    await trigger.click();
    const capture = page.getByRole("dialog", { name: "快速捕获" });
    await capture
      .getByRole("button", { name: "Markdown 笔记", exact: true })
      .click();
    const title = capture.getByLabel("标题", { exact: true });
    const marker = `M04 capture ${Date.now()}`;
    await title.fill(`${marker} first`);
    await expect(
      capture.getByRole("button", { name: "保存并继续", exact: true }),
    ).toBeEnabled();
    await title.press("Enter");
    await expect(capture.getByRole("status")).toHaveText(
      "笔记已加密保存并同步。",
    );
    await expect(title).toHaveValue("");
    await expect(title).toBeFocused();
    await title.fill(`${marker} second`);
    await capture
      .getByRole("button", { name: "保存并关闭", exact: true })
      .click();
    await expect(capture).toHaveCount(0);
    await expect(trigger).toBeFocused();
    const toast = page.locator("[data-sonner-toast]");
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText("笔记已加密保存并同步。");
    await page.locator('a[href="/app/records"]').first().click();
    await expect(
      page.getByRole("button", { name: new RegExp(`${marker} first，更新于`) }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", {
        name: new RegExp(`${marker} second，更新于`),
      }),
    ).toHaveCount(1);
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

  test("desktop sidebar keyboard traversal reaches routes and restores overlay focus", async ({
    page,
  }, testInfo) => {
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((value) => {
        localStorage.setItem("app-shell-theme", value);
      }, theme);
      await page.goto("/app/today");
      await page.setViewportSize({ width: 1440, height: 900 });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const sidebar = page.getByTestId("app-sidebar");
      await expect(sidebar).not.toHaveAttribute("inert");
      const controls = sidebar.locator("a[href], button:not([disabled])");
      await controls.first().focus();
      for (let index = 0; index < (await controls.count()); index += 1) {
        const control = controls.nth(index);
        await expect(control).toBeFocused();
        await expect(control).toBeInViewport();
        expect(
          await control.evaluate((element) => {
            const style = getComputedStyle(element);
            return style.outlineStyle !== "none" || style.boxShadow !== "none";
          }),
          "Keyboard focus has a visible indicator",
        ).toBe(true);
        await page.keyboard.press("Tab");
      }
      expect(
        await sidebar.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(false);
      await page.keyboard.press("Shift+Tab");
      await expect(controls.last()).toBeFocused();
      const route = sidebar.locator('a[href="/app/planning"]');
      await route.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/app\/planning$/);
      await expect(route).toHaveAttribute("aria-current", "page");
      const command = page.getByRole("button", {
        name: /搜索、导航或执行命令/,
      });
      await command.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("dialog", { name: "搜索、跳转与执行" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(command).toBeFocused();
      await page.screenshot({
        path: testInfo.outputPath(`desktop-sidebar-${theme}.png`),
      });
    }
  });
});
