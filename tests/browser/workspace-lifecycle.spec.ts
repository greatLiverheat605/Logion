import { randomBytes, randomUUID } from "node:crypto";
import type { BrowserContext } from "@playwright/test";

import { expect, test } from "./fixtures";

test.use({ trace: "off", screenshot: "off", video: "off" });

async function mutationHeaders(context: BrowserContext, origin: string) {
  const csrf = (await context.cookies(origin)).find(
    (cookie) => cookie.name === "logion_csrf",
  );
  if (!csrf) throw new Error("Lifecycle verification requires a CSRF cookie");
  return { Origin: origin, "X-CSRF-Token": csrf.value };
}

test("ownership transfer and account deletion preserve live permission boundaries", async ({
  accountState,
  browser,
  page,
}) => {
  test.setTimeout(150_000);
  const origin = new URL(page.url()).origin;
  test.skip(
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname) ||
      !/^m5-.*@example\.com$/.test(accountState.email),
    "Account lifecycle acceptance requires an isolated local M5 synthetic account",
  );
  const recipient = await browser.newContext({ serviceWorkers: "block" });
  try {
    const email = `m5-lifecycle-${randomUUID()}@example.com`;
    const registered = await recipient.request.post(
      `${origin}/api/v1/auth/register`,
      {
        headers: { Origin: origin },
        data: {
          email,
          password: `${randomBytes(24).toString("base64url")}Aa1!`,
          device_name: "Local lifecycle recipient",
        },
      },
    );
    expect(registered.status()).toBe(201);
    const recipientId = (await registered.json()).user.id as string;
    const workspaces = await page.request.get("/api/v1/workspaces");
    expect(workspaces.status()).toBe(200);
    const workspace = (await workspaces.json()).workspaces[0] as { id: string };
    const base = `/api/v1/workspaces/${workspace.id}`;
    await page.goto("/app/workspaces");
    await page.getByRole("button", { name: "邀请新成员", exact: true }).click();
    const invite = page.getByRole("dialog", {
      name: "邀请新成员",
      exact: true,
    });
    await invite.getByLabel("邮箱", { exact: true }).fill(email);
    const issuedPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${base}/invitations` &&
        response.request().method() === "POST",
    );
    await invite.getByRole("button", { name: "发送邀请", exact: true }).click();
    const issued = await issuedPromise;
    expect(issued.status()).toBe(201);
    const token = (await issued.json()).token as string;
    expect(typeof token === "string" && token.length >= 32).toBe(true);
    const acceptingPage = await recipient.newPage();
    await acceptingPage.goto(
      `${origin}/invitations/accept#token=${encodeURIComponent(token)}`,
    );
    await expect(
      acceptingPage.getByRole("button", { name: "接受邀请", exact: true }),
    ).toBeVisible();
    await expect.poll(() => new URL(acceptingPage.url()).hash).toBe("");
    await acceptingPage
      .getByRole("button", { name: "接受邀请", exact: true })
      .click();
    await expect(
      acceptingPage.getByRole("heading", { name: "已加入工作区", exact: true }),
    ).toBeVisible();
    const members = async () => {
      const response = await page.request.get(`${base}/members`);
      expect(response.status()).toBe(200);
      return (await response.json()).members as Array<{
        id: string;
        user_id: string;
        email: string;
        role: string;
        version: number;
      }>;
    };
    const originalOwner = (await members()).find(
      (member) => member.role === "owner",
    )!;
    const target = (await members()).find(
      (member) => member.user_id === recipientId,
    )!;
    expect(target).toBeDefined();

    await page.goto("/app/data");
    await page
      .getByRole("button", { name: "请求删除账户", exact: true })
      .click();
    const deletion = page.getByRole("dialog", {
      name: "请求删除账户",
      exact: true,
    });
    await deletion
      .getByLabel("输入 DELETE MY ACCOUNT 确认")
      .fill("DELETE MY ACCOUNT");
    const rejectedPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/account-deletion" &&
        response.request().method() === "POST",
    );
    await deletion
      .getByRole("button", { name: "请求删除账户", exact: true })
      .click();
    expect((await rejectedPromise).status()).toBe(409);
    await expect(deletion).toBeVisible();
    expect(
      (await members()).find((member) => member.id === originalOwner.id)?.role,
    ).toBe("owner");
    await deletion.getByRole("button", { name: "取消", exact: true }).click();

    await page.goto("/app/workspaces");
    await page.getByRole("tab", { name: "危险操作", exact: true }).click();
    const transferButton = page.getByRole("button", {
      name: "转移 Workspace 所有权",
      exact: true,
    });
    await transferButton.click();
    const transfer = page.getByRole("dialog", {
      name: "转移 Workspace 所有权",
      exact: true,
    });
    await expect(
      transfer.getByRole("button", { name: "确认转移", exact: true }),
    ).toBeDisabled();
    await transfer.getByLabel("新的所有者").selectOption(target.id);
    await transfer.getByRole("button", { name: "取消", exact: true }).click();
    expect(
      (await members()).find((member) => member.id === originalOwner.id)?.role,
    ).toBe("owner");
    await transferButton.click();
    await transfer.getByLabel("新的所有者").selectOption(target.id);
    const transferredPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `${base}/ownership/transfer` &&
        response.request().method() === "POST",
    );
    await transfer
      .getByRole("button", { name: "确认转移", exact: true })
      .click();
    expect((await transferredPromise).status()).toBe(200);
    await expect(transfer).toHaveCount(0);
    await expect(transferButton).toBeDisabled();
    const after = await members();
    expect(after.filter((member) => member.role === "owner")).toHaveLength(1);
    expect(after.find((member) => member.id === target.id)?.role).toBe("owner");
    expect(after.find((member) => member.id === originalOwner.id)?.role).toBe(
      "admin",
    );
    const forbidden = await page.request.post(`${base}/ownership/transfer`, {
      headers: await mutationHeaders(page.context(), origin),
      data: {
        expected_current_owner_version: after.find(
          (member) => member.id === target.id,
        )!.version,
        expected_target_version: after.find(
          (member) => member.id === originalOwner.id,
        )!.version,
        expected_workspace_version: 1,
        previous_owner_role: "admin",
        target_membership_id: originalOwner.id,
      },
    });
    expect(forbidden.status()).toBe(403);

    await page.goto("/app/data");
    await page
      .getByRole("button", { name: "请求删除账户", exact: true })
      .click();
    await deletion
      .getByLabel("输入 DELETE MY ACCOUNT 确认")
      .fill("DELETE MY ACCOUNT");
    const acceptedPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/account-deletion" &&
        response.request().method() === "POST",
    );
    await deletion
      .getByRole("button", { name: "请求删除账户", exact: true })
      .click();
    expect((await acceptedPromise).status()).toBe(202);
    await expect(page).toHaveURL(/\/account\/deletion$/);
    expect((await page.request.get("/api/v1/workspaces")).status()).toBe(401);
    await page.goto("/auth/login");
    await page.getByLabel("邮箱", { exact: true }).fill(accountState.email);
    await page.getByLabel("密码", { exact: true }).fill(accountState.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/account\/deletion$/);
    expect((await page.request.get("/api/v1/workspaces")).status()).toBe(403);
    const retained = await recipient.request.get(`${origin}${base}/members`);
    expect(retained.status()).toBe(200);
    expect(
      (await retained.json()).members.some(
        (member: { user_id: string; role: string }) =>
          member.user_id === recipientId && member.role === "owner",
      ),
    ).toBe(true);
    const keep = page.getByRole("button", {
      name: "保留我的账户",
      exact: true,
    });
    await page.getByLabel("确认短语", { exact: true }).fill("KEEP MY ACCOUN");
    await expect(keep).toBeDisabled();
    await page.getByLabel("确认短语", { exact: true }).fill("KEEP MY ACCOUNT");
    const cancelledPromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/account-deletion/cancel" &&
        response.request().method() === "POST",
    );
    await keep.click();
    expect((await cancelledPromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/app(?:\/today)?$/);
    expect((await page.request.get("/api/v1/workspaces")).status()).toBe(200);
  } finally {
    await recipient.close();
  }
});
