import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  assertGlmPrimaryContract,
  assertGlmRouteRegions,
  loadGlmTargetManifest,
} from "./glm-conformance";
import {
  auditHorizontalOverflow,
  auditReducedMotion,
  captureEvidenceScreenshot,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

// Default headless Chromium hides the classic scrollbar that exposed the 15 px bug.
test.use({
  launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
  serviceWorkers: "block",
});
test.describe("M07 public geometry and copy", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`public entrances fit classic scrollbars in ${theme}`, async ({
      page,
    }, testInfo) => {
      test.skip(
        testInfo.project.name !== "public-chromium",
        "Classic Chromium geometry; other engines retain the shared accessibility suite.",
      );
      test.setTimeout(180_000);
      await page.addInitScript(
        (value) => localStorage.setItem("app-shell-theme", value),
        theme,
      );
      const measurements: unknown[] = [];
      const requestId = "m07-" + "abcdefghij".repeat(24);
      await page.route("**/api/v1/auth/login", (route) =>
        route.fulfill({
          status: 401,
          json: {
            code: "AUTH_INVALID_CREDENTIALS",
            message: "Synthetic private detail",
            request_id: requestId,
            retryable: false,
          },
        }),
      );
      for (const width of [320, 375, 1440]) {
        await page.setViewportSize({ width, height: 640 });
        for (const route of [
          "/",
          "/auth/login",
          "/auth/register",
          "/auth/recover",
          "/m07-missing-page",
        ]) {
          await page.goto(route);
          await expect(page.locator("h1")).toHaveCount(1);
          await expect(page.locator("h1")).toBeVisible();
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          if (route === "/") {
            await expect(
              page.getByText("把记录、学习和执行连接起来的个人工作台。"),
            ).toBeVisible();
            await expect(
              page.getByRole("link", { name: "受邀注册" }),
            ).toHaveAttribute("href", "/auth/register");
            await expect(
              page.getByRole("link", { name: "找回密码" }),
            ).toHaveAttribute("href", "/auth/recover");
          }
          if (route === "/auth/register")
            await expect(page.locator("h1")).toHaveText("受邀注册");
          if (route === "/auth/recover") {
            await expect(
              page.getByText(
                "所有邮箱都会得到相同响应，避免泄漏账户是否存在。",
                { exact: true },
              ),
            ).toHaveCount(1);
          }
          if (route === "/auth/login") {
            await page
              .getByLabel("邮箱", { exact: true })
              .fill("synthetic@example.test");
            await page
              .getByLabel("密码", { exact: true })
              .fill("Synthetic-password-42!");
            await page
              .getByRole("button", { name: "登录", exact: true })
              .click();
            const alert = page
              .getByTestId("login-credentials")
              .getByRole("alert");
            await expect(alert).toContainText("登录未完成");
            await expect(alert).toContainText(requestId);
            await expect(alert).not.toContainText("Synthetic private detail");
            await expect(alert).toBeFocused();
          }
          const audit = await auditHorizontalOverflow(page);
          measurements.push({ route, width, theme, ...audit });
          expect(audit.offenders, JSON.stringify(audit)).toEqual([]);
          expect(audit.scrollWidth, JSON.stringify(audit)).toBe(
            audit.clientWidth,
          );
          if (width === 320 && route === "/auth/login")
            expect(audit.scrollbarWidth).toBeGreaterThan(0);
          const axe = await new AxeBuilder({ page })
            .withTags(wcagTags)
            .analyze();
          expect(axe.violations).toEqual([]);
          if (route === "/auth/login") {
            await page
              .getByRole("button", { name: "登录", exact: true })
              .hover();
            const hovered = await new AxeBuilder({ page })
              .withTags(wcagTags)
              .analyze();
            expect(hovered.violations).toEqual([]);
          }
          if (width === 320)
            await page.screenshot({
              path: testInfo.outputPath(route.replaceAll("/", "-") + ".png"),
              fullPage: true,
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
const manifest = loadGlmTargetManifest();
const evidencePhase =
  process.env.LOGION_EVIDENCE_PHASE === "before" ? "before" : "after";

test("login inline validation is immediate, accessible and makes no invalid authentication request", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/v1/auth/login", async (route) => {
    requests++;
    await route.fulfill({
      status: 401,
      json: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "Synthetic private detail",
        request_id: "m04-login-rejected",
        retryable: false,
      },
    });
  });
  await page.goto("/auth/login");
  const email = page.getByLabel("邮箱", { exact: true });
  const password = page.getByLabel("密码", { exact: true });
  const submit = page.getByRole("button", { name: "登录", exact: true });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("请输入邮箱。", { exact: true })).toBeVisible({
    timeout: 200,
  });
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-describedby", "login-email-error");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await email.fill("invalid-email");
  await email.press("Enter");
  await expect(
    page.getByText("请输入有效的邮箱地址。", { exact: true }),
  ).toBeVisible({ timeout: 200 });
  expect(requests).toBe(0);
  const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
  expect(axe.violations).toEqual([]);
  await email.fill("synthetic@example.test");
  await password.fill("Synthetic-password-42!");
  await submit.click();
  const failure = page.getByTestId("login-credentials").getByRole("alert");
  await expect(failure).toContainText("m04-login-rejected");
  await expect(failure).not.toContainText("Synthetic private detail");
  await expect(password).toHaveValue("Synthetic-password-42!");
  expect(requests).toBe(1);
});
const publicRoutes = [
  "/",
  "/auth/login",
  "/auth/register",
  "/auth/verify",
  "/auth/recover",
  "/auth/callback",
  "/offline",
] as const;

for (const route of publicRoutes) {
  test(`${route} has no automated WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations).toEqual([]);
  });
}

for (const { route, url } of [
  { route: "/auth/login", url: "/auth/login" },
  { route: "/auth/register", url: "/auth/register" },
  { route: "/auth/verify", url: "/auth/verify" },
  { route: "/auth/recover", url: "/auth/recover" },
  { route: "/auth/callback", url: "/auth/callback" },
] as const) {
  test(`${route} exposes its GLM regions and at most one primary`, async ({
    page,
  }) => {
    await page.goto(url);
    await page
      .getByTestId(
        manifest.routes.find((item) => item.route === route)!.regions[0]!,
      )
      .waitFor();
    await assertGlmRouteRegions(page, manifest, route);
    await assertGlmPrimaryContract(page, manifest, route);
  });
}

test("captures public authentication evidence at all product viewports", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "public-chromium",
    "Canonical evidence uses the Chromium production viewport set.",
  );
  for (const route of [
    "/auth/login",
    "/auth/register",
    "/auth/verify",
    "/auth/recover",
    "/auth/callback",
  ] as const) {
    const firstRegion = manifest.routes.find((item) => item.route === route)!
      .regions[0]!;
    for (const viewport of WORKBENCH_VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(route);
      if (evidencePhase === "after") {
        await page.getByTestId(firstRegion).waitFor();
        await assertGlmRouteRegions(page, manifest, route);
        await assertGlmPrimaryContract(page, manifest, route);
      } else {
        await expect(page.locator("main")).toBeVisible();
      }
      const overflow = await auditHorizontalOverflow(page);
      if (evidencePhase === "after") {
        expect(
          overflow.offenders,
          `${route} @ ${viewport.label} must not leak horizontally`,
        ).toEqual([]);
        expect(overflow.scrollWidth).toBe(overflow.clientWidth);
      }
      await captureEvidenceScreenshot(page, evidencePhase, route, viewport);
    }
  }
});

test("authentication preserves password manager, paste and visibility controls", async ({
  page,
}) => {
  await page.goto("/auth/login");
  const email = page.getByLabel("邮箱");
  const password = page.locator("#login-password");
  await expect(email).toHaveAttribute("autocomplete", "email");
  await expect(password).toHaveAttribute("autocomplete", "current-password");

  const pasteAllowed = await password.evaluate((element) =>
    element.dispatchEvent(
      new Event("paste", { bubbles: true, cancelable: true }),
    ),
  );
  expect(pasteAllowed).toBe(true);

  await password.fill("visible-password-check");
  await page.getByRole("button", { name: "显示密码" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏密码" }).click();
  await expect(password).toHaveAttribute("type", "password");
});

test("callback failure keeps retry and login recovery reachable", async ({
  page,
}) => {
  await page.goto("/auth/callback");
  await expect(
    page.getByRole("heading", { name: "无法完成登录" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回登录" })).toBeVisible();
});

test("skip link and authentication controls are keyboard reachable", async ({
  browserName,
  isMobile,
  page,
}) => {
  test.skip(
    browserName === "webkit" || isMobile,
    "Safari link tabbing and physical mobile keyboards require manual sign-off",
  );
  await page.goto("/auth/login");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Logion" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "切换到深色主题" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("邮箱")).toBeFocused();
});

test("login secondary action remains readable in the light theme", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("app-shell-theme", "light"),
  );
  await page.goto("/auth/login");

  const passkeyButton = page.getByRole("button", {
    name: "使用 Passkey 登录",
  });
  await expect(passkeyButton).toBeVisible();
  const colors = await passkeyButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      foreground: style.color,
    };
  });
  expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(colors.foreground).not.toBe(colors.background);
});

for (const route of publicRoutes) {
  test(`${route} fits a narrow viewport without page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(route);
    const hasOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    );
    expect(
      hasOverflow,
      `${route} must not overflow at a 320 CSS px viewport`,
    ).toBe(false);
  });
}

test("reduced-motion preference does not leave forced animation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const movingElements = await auditReducedMotion(page, "#main-content *");
  expect(movingElements).toEqual([]);
});

test("theme bootstrap applies a persisted preference before hydration", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("app-shell-theme", "dark"),
  );
  await page.goto("/auth/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => localStorage.removeItem("app-shell-theme"));
});
