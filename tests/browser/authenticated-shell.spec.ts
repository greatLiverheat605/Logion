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
      commandDialog.getByRole("heading", { name: "今天", exact: true }),
    ).toBeVisible();
    await expect(
      commandDialog.getByRole("heading", { name: "工作台", exact: true }),
    ).toBeVisible();
    await expect(
      commandDialog.getByRole("heading", { name: "知识库", exact: true }),
    ).toBeVisible();
    await expect(
      commandDialog.getByRole("heading", { name: "协作空间", exact: true }),
    ).toBeVisible();
    await expect(
      commandDialog.getByRole("heading", { name: "系统中心", exact: true }),
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
      await page.goto(route, { waitUntil: "load" });
      await expect(page.locator(".app-shell-frame h1")).toBeVisible();

      const reducedMotionMatches = await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
      expect(
        reducedMotionMatches,
        `${route} must run with reduced motion enabled`,
      ).toBe(true);

      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const shell = document.querySelector(".app-shell-frame");
              if (!shell) {
                return {
                  count: 0,
                  elements: [],
                  shellPresent: false,
                  unresolvedElements: [],
                };
              }

              const describeElement = (element: Element) => ({
                ariaLabel: element.getAttribute("aria-label"),
                className:
                  typeof element.className === "string"
                    ? element.className
                    : null,
                id: element.id || null,
                tagName: element.tagName.toLowerCase(),
              });
              const elements = [shell, ...shell.querySelectorAll("*")];
              const unresolvedElements = elements.flatMap((element) => {
                const style = getComputedStyle(element);
                if (
                  style.animationDuration.length > 0 &&
                  style.animationName.length > 0 &&
                  style.transitionDuration.length > 0 &&
                  style.transitionProperty.length > 0
                ) {
                  return [];
                }
                return [describeElement(element)];
              });
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
                    ...describeElement(element),
                    transitionDuration: style.transitionDuration,
                    transitionProperty: style.transitionProperty,
                  },
                ];
              });
              return {
                count: movingElements.length,
                elements: movingElements.slice(0, 50),
                shellPresent: true,
                unresolvedElements: unresolvedElements.slice(0, 50),
              };
            }),
          { message: `${route} must honor reduced motion` },
        )
        .toEqual({
          count: 0,
          elements: [],
          shellPresent: true,
          unresolvedElements: [],
        });
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

  test("workspace and review context switching discard stale detail responses", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const suffix = Date.now().toString(36);
    const workspaceAName = `竞态工作区 A ${suffix}`;
    const workspaceBName = `竞态工作区 B ${suffix}`;
    const spaceAName = `A 空间 ${suffix}`;
    const spaceBName = `B 空间 ${suffix}`;

    await page.goto("/app/workspaces");

    const createWorkspace = async (name: string) => {
      const disclosure = page.locator("details", {
        has: page.getByText("新建工作区", { exact: true }),
      });
      if (!(await disclosure.evaluate((element) => element.open))) {
        await disclosure.locator("summary").click();
      }
      await page.getByRole("textbox", { name: /工作区名称/ }).fill(name);
      await page.getByRole("button", { name: "创建工作区" }).click();
      await expect(page.locator("#workspace-feedback")).toHaveText(
        "工作区已创建并切换。",
      );
    };

    const createSpace = async (name: string) => {
      const disclosure = page.locator("details", {
        has: page.getByText("新建 Space", { exact: true }),
      });
      if (!(await disclosure.evaluate((element) => element.open))) {
        await disclosure.locator("summary").click();
      }
      await page.getByRole("textbox", { name: /空间名称/ }).fill(name);
      await page.getByRole("button", { name: "创建 Space" }).click();
      await expect(page.locator("#space-feedback")).toHaveText("空间已创建。");
    };

    await createWorkspace(workspaceAName);
    await createSpace(spaceAName);
    await createWorkspace(workspaceBName);
    await createSpace(spaceBName);

    const workspaceResponse = await page.request.get("/api/v1/workspaces");
    expect(workspaceResponse.ok()).toBe(true);
    const workspacePayload = (await workspaceResponse.json()) as {
      workspaces: Array<{ id: string; name: string }>;
    };
    const workspaceA = workspacePayload.workspaces.find(
      (workspace) => workspace.name === workspaceAName,
    );
    expect(workspaceA).toBeDefined();

    let delayedRequests = 0;
    await page.route(
      `**/api/v1/workspaces/${workspaceA!.id}/**`,
      async (route) => {
        delayedRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.continue();
      },
    );

    await page
      .locator(".workspace-context-list")
      .getByRole("button", { name: new RegExp(workspaceAName) })
      .click();
    await page
      .locator(".workspace-context-list")
      .getByRole("button", { name: new RegExp(workspaceBName) })
      .click();

    await expect(page.getByText(spaceBName, { exact: true })).toBeVisible();
    await page.waitForTimeout(800);
    expect(delayedRequests).toBeGreaterThan(0);
    await expect(page.getByText(spaceAName, { exact: true })).toHaveCount(0);

    await page.unrouteAll({ behavior: "wait" });
    await page.route(
      `**/api/v1/workspaces/${workspaceA!.id}/spaces`,
      async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.continue();
      },
    );

    await page.goto("/app/review");
    const reviewWorkspace = page.getByLabel("工作区", { exact: true });
    await expect(reviewWorkspace).toBeVisible();
    await reviewWorkspace.selectOption({ label: workspaceAName });
    await reviewWorkspace.selectOption({ label: workspaceBName });

    const reviewSpace = page.getByLabel("空间", { exact: true });
    await expect(
      reviewSpace.getByRole("option", { name: new RegExp(spaceBName) }),
    ).toHaveCount(1);
    await page.waitForTimeout(800);
    await expect(
      reviewSpace.getByRole("option", { name: new RegExp(spaceAName) }),
    ).toHaveCount(0);
    await expect(reviewWorkspace).toHaveValue(
      workspacePayload.workspaces.find(
        (workspace) => workspace.name === workspaceBName,
      )!.id,
    );
  });
});
