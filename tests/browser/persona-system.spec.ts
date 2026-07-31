import { expect, test, type Page } from "@playwright/test";

const email = process.env.LOGION_E2E_EMAIL;
const password = process.env.LOGION_E2E_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/auth/login");
  await page.getByLabel("邮箱").fill(email ?? "");
  await page.getByLabel("密码").fill(password ?? "");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:app(?:\/today)?|onboarding)$/);
  await page.evaluate(async () => {
    const csrf = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("logion_csrf="))
      ?.slice("logion_csrf=".length);
    if (!csrf) throw new Error("Missing CSRF cookie");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = (await fetch("/api/v1/users/me/settings?key=persona", {
        credentials: "same-origin",
      }).then((response) => response.json())) as {
        settings: Array<{ key: string; version: number }>;
      };
      if (current.settings.length > 0) return;
      const saved = await fetch("/api/v1/users/me/settings", {
        body: JSON.stringify({
          settings: [
            {
              key: "persona",
              value: '{"activePersonaId":"self","customPersonas":[]}',
              version: 0,
            },
          ],
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        method: "PUT",
      });
      if (saved.ok) return;
      if (saved.status !== 409)
        throw new Error(`Persona seed failed: ${saved.status}`);
    }
    throw new Error("Persona seed did not converge");
  });
}

test.describe("persona system", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !email || !password,
    "Set the authenticated browser fixture credentials.",
  );

  test.beforeEach(async ({ browserName, isMobile, page }) => {
    test.skip(
      browserName !== "chromium" || isMobile,
      "Runs once against the shared fixture.",
    );
    await signIn(page);
  });

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
      page.getByRole("heading", { name: "设置首个学习目标" }),
    ).toBeVisible();
  });

  test("sidebar shows only routes visible to the active persona", async ({
    page,
  }) => {
    await page.goto("/app/today");
    const navigation = page.getByRole("navigation", { name: "主导航" });
    await expect(navigation.getByRole("link", { name: "考试" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "复习" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "审计" })).toHaveCount(0);
    await expect(navigation.getByRole("link", { name: "空间" })).toHaveCount(0);
  });

  test("settings switch updates the sidebar immediately", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByRole("button", { name: /^切换到：导，/ }).click();
    const navigation = page.getByRole("navigation", { name: "主导航" });
    await expect(navigation.getByRole("link", { name: "审计" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "空间" })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "考试" })).toHaveCount(0);

    await page.goto("/app/today");
    await expect(
      page.getByRole("heading", {
        name: "围绕空间、审计和协作治理安排今天",
      }),
    ).toBeVisible();
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
});
