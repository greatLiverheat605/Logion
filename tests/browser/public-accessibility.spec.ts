import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const route of ["/", "/auth/login", "/auth/register", "/offline"]) {
  test(`${route} has no automated WCAG 2.2 AA violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator("main")).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(results.violations).toEqual([]);
  });
}

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

for (const route of ["/", "/auth/login", "/auth/register", "/offline"]) {
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
  const movingElements = await page.locator("body *").evaluateAll(
    (elements) =>
      elements.filter((element) => {
        const style = getComputedStyle(element);
        return (
          (style.animationName !== "none" &&
            style.animationDuration !== "0s") ||
          (style.transitionDuration !== "0s" &&
            style.transitionProperty !== "none")
        );
      }).length,
  );
  expect(movingElements).toBe(0);
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
