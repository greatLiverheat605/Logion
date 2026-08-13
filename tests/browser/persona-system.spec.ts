import { randomBytes, randomUUID } from "node:crypto";

import { test as baseTest } from "@playwright/test";

import { expect, test } from "./fixtures";

baseTest(
  "a newly registered account is forced into onboarding on first login",
  async ({ page }) => {
    await page.goto("/auth/login");
    const email = `persona-onboarding-${randomUUID()}@example.com`;
    const password = `${randomBytes(24).toString("base64url")}Aa1!`;
    const registered = await page.request.post("/api/v1/auth/register", {
      data: {
        device_name: "Persona onboarding guard",
        email,
        password,
      },
      headers: { Origin: new URL(page.url()).origin },
    });
    expect(registered.status(), await registered.text()).toBe(201);

    await page.context().clearCookies();
    await page.goto("/auth/login");
    await page.getByLabel("邮箱").fill(email);
    await page.getByLabel("密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(
      page.getByRole("heading", { name: "选择你的学习场景" }),
    ).toBeVisible();
    await page.goto("/app/today");
    await expect(page).toHaveURL(/\/onboarding$/);
  },
);

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

  test("sidebar keeps five stable areas with a persona-aware workbench", async ({
    page,
  }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /^切换到：考，/ }).click();
    await expect(page.getByText("已切换到「考」画像。")).toBeVisible();
    const navigation = page.getByRole("complementary", { name: "主导航" });
    await expect(navigation.locator(".app-nav-scroll a")).toHaveText([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
    await expect(
      navigation.getByRole("link", { name: "工作台" }),
    ).toHaveAttribute("href", "/app/exam");
  });

  test("settings switch updates the workbench target immediately", async ({
    page,
  }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /^切换到：导，/ }).click();
    await expect(page.getByText("已切换到「导」画像。")).toBeVisible();
    const navigation = page.getByRole("complementary", { name: "主导航" });
    await expect(navigation.locator(".app-nav-scroll a")).toHaveText([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
    await expect(
      navigation.getByRole("link", { name: "工作台" }),
    ).toHaveAttribute("href", "/app/self-study");

    await page.goto("/app/today");
    await expect(
      page.getByRole("heading", {
        name: "只在授权共享范围内组织协作与审阅",
      }),
    ).toBeVisible();
  });

  test("today heading follows all four built-in personas even while the Vault is locked", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const expectations = [
      ["考", "用真实日期、复习与成绩安排备考"],
      ["学", "让目标、项目与成果形成连续进展"],
      ["研", "把问题、论文、声明与运行放在同一证据链"],
      ["导", "只在授权共享范围内组织协作与审阅"],
    ] as const;

    await page.goto("/app/settings");
    for (const [persona, heading] of expectations) {
      await page
        .getByRole("button", { name: new RegExp(`^切换到：${persona}，`) })
        .click();
      await expect(
        page.getByText(`已切换到「${persona}」画像。`),
      ).toBeVisible();
      await page.goto("/app/today");
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "先解锁本地资料" }),
      ).toBeVisible();
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
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
    await expect(
      navigation.getByRole("link", { name: "工作台" }),
    ).toHaveAttribute("href", "/app/exam");

    await page.getByRole("button", { name: /^切换到：导，/ }).click();
    await expect(page.getByText("已切换到「导」画像。")).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveText([
      "今天",
      "工作台",
      "知识库",
      "协作空间",
      "系统中心",
    ]);
    await expect(
      navigation.getByRole("link", { name: "工作台" }),
    ).toHaveAttribute("href", "/app/self-study");
  });
});
