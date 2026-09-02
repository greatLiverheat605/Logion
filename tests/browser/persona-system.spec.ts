import { expect, test } from "./fixtures";

test.describe("persona system", () => {
  test.describe.configure({ mode: "serial" });

  test("onboarding starts with a required persona selection", async ({
    page,
  }) => {
    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: "选择你的学习场景" }),
    ).toBeVisible();
    const continueButton = page.getByRole("button", {
      name: "继续",
      exact: true,
    });
    await expect(continueButton).toBeDisabled();
    const exam = page.getByRole("button", { name: /^考：/ });
    await exam.click();
    await expect(exam).toHaveAttribute("aria-pressed", "true");
    await continueButton.click();
    await expect(
      page.getByRole("heading", { name: "创建或选择工作区" }),
    ).toBeVisible();
  });

  test("sidebar shows only routes visible to the active persona", async ({
    page,
  }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /^切换到：考，/ }).click();
    await expect(page.getByText("已切换到「考」画像。")).toBeVisible();
    const navigation = page.getByRole("complementary", { name: "主导航" });
    await expect(navigation.getByRole("link", { name: "考试" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "复习" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "审计" })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "空间" })).toHaveCount(0);
  });

  test("settings switch updates the sidebar immediately", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /^切换到：导，/ }).click();
    await expect(page.getByText("已切换到「导」画像。")).toBeVisible();
    const navigation = page.getByRole("complementary", { name: "主导航" });
    await expect(navigation.getByRole("link", { name: "审计" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "空间" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "考试" })).toHaveCount(0);

    await page.goto("/app/today");
    await expect(
      page.getByRole("heading", { name: "今日驾驶舱" }),
    ).toBeVisible();
    await expect(
      page
        .getByLabel("当前工作台上下文")
        .locator("dt")
        .filter({ hasText: /^Persona$/ })
        .locator("..")
        .locator("dd"),
    ).toHaveText("导");
  });

  test("today context follows all four built-in personas even while the Vault is locked", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const expectations = ["考", "学", "研", "导"] as const;

    await page.goto("/app/settings");
    for (const persona of expectations) {
      await page
        .getByRole("button", { name: new RegExp(`^切换到：${persona}，`) })
        .click();
      await expect(
        page.getByText(`已切换到「${persona}」画像。`),
      ).toBeVisible();
      await page.goto("/app/today");
      await expect(
        page.getByRole("heading", { name: "今日驾驶舱" }),
      ).toBeVisible();
      await expect(
        page
          .getByLabel("当前工作台上下文")
          .locator("dt")
          .filter({ hasText: /^Persona$/ })
          .locator("..")
          .locator("dd"),
      ).toHaveText(persona);
      await page.goto("/app/settings");
    }
  });

  test("creates and removes a custom persona", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: "新建自定义画像" }).click();
    const dialog = page.getByRole("dialog", { name: "新建自定义画像" });
    await dialog.getByLabel("名称").fill("浏览器验收画像");
    await dialog.getByLabel("图标").selectOption("🎯");
    await dialog.getByLabel("自学").check();
    await dialog.getByLabel("考试").check();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByText("浏览器验收画像", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "删除自定义画像：浏览器验收画像" })
      .click();
    await expect(page.getByText("浏览器验收画像", { exact: true })).toHaveCount(
      0,
    );
  });

  test("mobile bottom navigation updates immediately with the persona", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/app/settings");
    const navigation = page.getByRole("navigation", { name: "移动端导航" });

    await page.getByRole("button", { name: /^切换到：考，/ }).click();
    await expect(page.getByText("已切换到「考」画像。")).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveText([
      "今日",
      "备考",
      "复习",
      "错题",
    ]);
    await expect(navigation.locator('a[href="/app/research"]')).toHaveCount(0);

    await page.getByRole("button", { name: /^切换到：导，/ }).click();
    await expect(page.getByText("已切换到「导」画像。")).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveText([
      "今日",
      "计划",
      "空间",
      "审计",
    ]);
    await navigation.getByRole("button", { name: "更多" }).click();
    const more = page.getByRole("dialog", { name: "更多" });
    await expect(more.getByRole("link", { name: /模板/ })).toBeVisible();
    await expect(more.getByRole("link", { name: /设置/ })).toBeVisible();
  });
});
