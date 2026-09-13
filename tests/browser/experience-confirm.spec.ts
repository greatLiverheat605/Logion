import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// All API traffic is fulfilled locally; no Provider or mail transport is used.
test.use({ serviceWorkers: "block" });
const token = "a".repeat(40);
const user = {
  id: "user-1",
  email: "invite@example.com",
  status: "active",
  created_at: "2026-01-01T00:00:00Z",
  email_verified_at: "2026-01-01T00:00:00Z",
};
const auth = { user, session_expires_at: "2099-01-01T00:00:00Z" };
const workspace = {
  id: "workspace-1",
  name: "测试工作区",
  role: "owner",
  membership_status: "active",
  status: "active",
  version: 1,
};

test("invitation login round trip keeps token out of requests and requires explicit acceptance", async ({
  page,
  context,
  baseURL,
}) => {
  let loggedIn = false;
  let accepted = 0;
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/login") {
      loggedIn = true;
      await context.addCookies([
        { name: "logion_csrf", value: "synthetic-csrf", url: baseURL! },
      ]);
      return route.fulfill({ json: auth });
    }
    if (path === "/api/v1/users/me/settings")
      return route.fulfill({
        json: {
          settings: [
            { key: "onboarding_completed", value: "true", version: 1 },
          ],
        },
      });
    if (path === "/api/v1/invitations/accept") {
      expect(route.request().postDataJSON()).toEqual({ token });
      if (!loggedIn)
        return route.fulfill({
          status: 401,
          json: {
            code: "AUTH_REQUIRED",
            message: "Login required",
            request_id: "test-request",
            retryable: false,
          },
        });
      accepted++;
      return route.fulfill({ json: workspace });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(`/invitations/accept#token=${token}`);
  await expect(
    page.getByRole("button", { name: "接受邀请", exact: true }),
  ).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.getByRole("button", { name: "接受邀请", exact: true }).click();
  await expect(
    page.getByTestId("invite-action").getByRole("alert"),
  ).toContainText("请先登录");
  await page.getByRole("link", { name: "先登录并完成验证" }).click();
  await expect(page.getByLabel("邮箱", { exact: true })).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).searchParams.get("next")).toBe(
    "/invitations/accept",
  );
  await page.getByLabel("邮箱", { exact: true }).fill(user.email);
  await page.getByLabel("密码", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "接受邀请", exact: true }),
  ).toBeVisible();
  expect(accepted).toBe(0);
  await page.getByRole("button", { name: "接受邀请", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "已加入工作区" }),
  ).toBeVisible();
  expect(accepted).toBe(1);
  expect(requestedUrls.every((url) => !url.includes(token))).toBe(true);
});

for (const theme of ["light", "dark"] as const) {
  test(`security confirmation keyboard, pending, error and nested focus in ${theme}`, async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      { name: "logion_csrf", value: "synthetic-csrf", url: baseURL! },
    ]);
    await page.addInitScript(
      (theme) => localStorage.setItem("app-shell-theme", theme),
      theme,
    );
    test.skip(
      test.info().project.name.includes("mobile"),
      "Keyboard-only checks run in desktop browser projects.",
    );
    let mutations = 0;
    let release!: () => void;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "DELETE") {
        mutations++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return route.fulfill({
          status: 403,
          json: {
            code: "AUTH_RECENT_LOGIN_REQUIRED",
            message: "Denied",
            request_id: "synthetic-request",
            retryable: false,
          },
        });
      }
      if (path === "/api/v1/auth/session") return route.fulfill({ json: auth });
      if (path === "/api/v1/users/me/settings")
        return route.fulfill({
          json: {
            settings: [
              { key: "onboarding_completed", value: "true", version: 1 },
            ],
          },
        });
      if (path === "/api/v1/auth/devices")
        return route.fulfill({
          json: {
            devices: [
              {
                id: "device-1",
                name: "测试设备",
                platform: "web",
                current: false,
                revoked_at: null,
              },
            ],
          },
        });
      if (path === "/api/v1/auth/passkeys")
        return route.fulfill({ json: { credentials: [] } });
      if (path === "/api/v1/auth/totp")
        return route.fulfill({
          json: { enabled: true, recovery_codes_remaining: 7 },
        });
      if (path === "/api/v1/workspaces")
        return route.fulfill({ json: { workspaces: [workspace] } });
      return route.fulfill({ json: { settings: [], spaces: [], items: [] } });
    });
    await page.goto("/app/security");
    await page.getByRole("button", { name: /^设备与会话/ }).click();
    const trigger = page.getByRole("button", { name: "撤销", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "撤销设备", exact: true });
    await expect(dialog.getByRole("button", { name: "取消" })).toBeFocused();
    await expect(dialog).toContainText("测试设备");
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "撤销设备", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(mutations).toBe(0);
    await trigger.press("Enter");
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({ path: `reports/o1/security-${theme}.png` });
    await dialog.getByRole("button", { name: "撤销设备", exact: true }).click();
    await expect.poll(() => mutations).toBe(1);
    await expect(
      dialog.getByRole("button", { name: "正在处理…", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    release();
    await expect(dialog.getByRole("alert")).toContainText("重新登录");
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: /^认证器与恢复/ }).click();
    await page.getByRole("button", { name: "管理 TOTP 与恢复码" }).click();
    const form = page
      .getByRole("button", { name: "关闭 TOTP", exact: true })
      .locator("..");
    await form.getByRole("textbox").fill("123456");
    await form.getByRole("button", { name: "关闭 TOTP", exact: true }).click();
    const nested = page.getByRole("dialog", { name: "关闭 TOTP", exact: true });
    await expect(nested.getByRole("button", { name: "取消" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(nested).toBeHidden();
    await expect(
      page
        .getByRole("dialog", { name: "认证器与恢复码", exact: true })
        .getByRole("button", { name: "关闭 TOTP", exact: true }),
    ).toBeFocused();
  });
}

test("creates a complete invitation link and provides clipboard success and failure feedback", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    { name: "logion_csrf", value: "synthetic-csrf", url: baseURL! },
  ]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copied: string }).copied = text;
        },
      },
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/auth/session") return route.fulfill({ json: auth });
    if (path === "/api/v1/users/me/settings")
      return route.fulfill({
        json: {
          settings: [
            { key: "onboarding_completed", value: "true", version: 1 },
          ],
        },
      });
    if (path === "/api/v1/workspaces")
      return route.fulfill({ json: { workspaces: [workspace] } });
    if (path.endsWith("/invitations"))
      return route.fulfill({
        status: 201,
        json: {
          id: "invitation-1",
          email: user.email,
          role: "viewer",
          status: "pending",
          expires_at: "2099-01-01T00:00:00Z",
          token,
        },
      });
    return route.fulfill({
      json: { spaces: [], members: [], settings: [], items: [] },
    });
  });
  await page.goto("/app/workspaces");
  await page.getByRole("tab", { name: /邀请/ }).click();
  await page.getByRole("button", { name: "邀请新成员", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "邀请新成员", exact: true });
  await dialog.getByLabel("邮箱", { exact: true }).fill(user.email);
  await dialog.getByRole("button", { name: "发送邀请", exact: true }).click();
  await expect(dialog).toBeHidden();
  const link = page.getByRole("textbox", { name: "完整邀请链接" });
  await expect(link).toHaveValue(
    `${baseURL}/invitations/accept#token=${token}`,
  );
  await page.getByRole("button", { name: "复制邀请链接" }).click();
  await expect(
    page.getByText("邀请链接已复制，请仅发送给受邀者。"),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(await link.inputValue());
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("blocked");
        },
      },
    });
  });
  await page.getByRole("button", { name: "复制邀请链接" }).click();
  await expect(
    page.getByText("复制失败，请手动选择并复制完整邀请链接。"),
  ).toBeVisible();
  await page.screenshot({ path: "reports/o1/invitation-link.png" });
});
