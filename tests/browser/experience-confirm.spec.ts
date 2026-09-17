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

for (const theme of ["light", "dark"] as const) {
  test(`Provider diagnostics show stored evidence without external requests in ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("app-shell-theme", value),
      theme,
    );
    let mutations = 0;
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!["GET", "HEAD"].includes(route.request().method())) mutations++;
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
      if (path.endsWith("/ai/providers"))
        return route.fulfill({
          json: {
            providers: [
              {
                id: "provider-1",
                name: "测试 Provider",
                base_url: "https://example.com",
                enabled: true,
                credential_configured: true,
                version: 1,
                last_health_status: "unhealthy",
                last_health_checked_at: "2026-09-01T00:00:00Z",
                last_health_error_code: "AI_PROVIDER_DNS_BLOCKED",
              },
            ],
          },
        });
      return route.fulfill({
        json: {
          models: [],
          routes: [],
          runs: [],
          drafts: [],
          spaces: [],
          notifications: [],
          monthly_token_budget: null,
        },
      });
    });
    await page.goto("/app/ai#ai-provider-center");

    const diagnostics = page.getByRole("region", { name: "Provider 诊断" });
    await expect(diagnostics).toContainText("未通过");
    await expect(diagnostics).toContainText("不要放宽地址安全限制");
    await expect(diagnostics.locator("time")).toHaveAttribute(
      "datetime",
      "2026-09-01T00:00:00.000Z",
    );
    expect(
      (
        await new AxeBuilder({ page })
          .include('[aria-label="Provider 诊断"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await diagnostics.screenshot({
      path: test.info().outputPath("diagnostics.png"),
    });
    expect(mutations).toBe(0);
  });
}

test("recent searches restore without submitting and disappear on reload", async ({
  page,
}) => {
  let searches = 0;
  const searchBodies: Record<string, unknown>[] = [];
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
    if (path.endsWith("/search")) {
      searches++;
      searchBodies.push(route.request().postDataJSON());
      return route.fulfill({ json: { results: [] } });
    }
    return route.fulfill({
      json: {
        spaces: [{ id: "space-1", name: "测试空间", visibility: "private" }],
        notifications: [],
        feeds: [],
        enabled_categories: [],
        timezone: "UTC",
      },
    });
  });
  await page.context().addCookies([
    {
      name: "logion_csrf",
      value: "synthetic-csrf",
      url: test.info().project.use.baseURL!,
    },
  ]);
  await page.goto("/app/search");
  const input = page.getByRole("searchbox");
  const query = "q".repeat(100);
  await input.fill(query);
  await input.press("Enter");
  const recent = page.getByRole("region", { name: "最近搜索" });
  await recent.getByRole("button", { name: query, exact: true }).click();
  await expect(input).toHaveValue(query);
  expect(searches).toBe(1);
  await page
    .getByRole("combobox", { name: "搜索空间" })
    .selectOption("space-1");
  await expect.poll(() => searchBodies.length).toBe(2);
  expect(searchBodies[1]?.space_id).toBe("space-1");
  await page.getByRole("combobox", { name: "搜索空间" }).selectOption("");
  await expect.poll(() => searchBodies.length).toBe(3);
  expect(searchBodies[2]).not.toHaveProperty("space_id");
  expect(
    await recent.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await recent.screenshot({
    path: test.info().outputPath("recent-search.png"),
  });
  await recent.getByRole("button", { name: "清空最近搜索" }).click();
  await expect(recent).toContainText("暂无最近搜索");
  await input.press("Enter");
  await expect(
    recent.getByRole("button", { name: query, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(recent).toContainText("暂无最近搜索");
});
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

for (const theme of ["light", "dark"] as const) {
  test(`attachment preflight blocks disabled ingest and permits explicit offline staging in ${theme}`, async ({
    page,
    browserName,
  }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("app-shell-theme", value),
      theme,
    );
    const wid = "11111111-1111-4111-8111-111111111111";
    const sid = "22222222-2222-4222-8222-222222222222";
    const did = "33333333-3333-4333-8333-333333333333";
    const uid = "44444444-4444-4444-8444-444444444444";
    const nid = "55555555-5555-4555-8555-555555555555";
    const timestamp = "2026-09-01T00:00:00Z";
    const canonical = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
      if (value && typeof value === "object")
        return `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
          .join(",")}}`;
      return JSON.stringify(value);
    };
    const hash = (value: unknown) =>
      "sha256:" + createHash("sha256").update(canonical(value)).digest("hex");
    const payload = {
      title: "本地附件测试",
      markdown_body: "合成内容",
      space_id: sid,
      task_id: null,
    };
    const records = [
      {
        entity_type: "note",
        entity_id: nid,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        deleted_at: null,
        created_by: uid,
        updated_by: uid,
        payload,
        payload_hash: hash(payload),
      },
    ];
    const checksum = hash(records);
    let offline = false;
    let offlineRequests = 0;
    let capabilityReads = 0;
    let enabled = false;
    let uploads = 0;
    await page.route("**/api/v1/**", async (route) => {
      if (offline) {
        offlineRequests++;
        return route.abort("internetdisconnected");
      }
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/v1/auth/session")
        return route.fulfill({ json: { ...auth, user: { ...user, id: uid } } });
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
          json: { devices: [{ id: did, current: true }] },
        });
      if (path === "/api/v1/workspaces")
        return route.fulfill({
          json: { workspaces: [{ ...workspace, id: wid }] },
        });
      if (path.endsWith("/spaces"))
        return route.fulfill({
          json: {
            spaces: [
              {
                id: sid,
                name: "附件测试空间",
                visibility: "private",
                owner_user_id: uid,
              },
            ],
          },
        });
      if (path.endsWith("/sync/bootstrap"))
        return route.fulfill({
          json: {
            message_type: "bootstrap_response",
            protocol_version: "sync-v1",
            min_supported_version: "sync-v1",
            workspace_id: wid,
            device_id: did,
            sync_epoch: uid,
            snapshot_schema_version: 1,
            snapshot_id: nid,
            chunk_index: 0,
            chunk_count: 1,
            cursor: 0,
            snapshot_checksum: hash({
              chunks: [{ chunk_index: 0, chunk_checksum: checksum }],
            }),
            chunk_checksum: checksum,
            records,
            created_at: timestamp,
          },
        });
      if (path.endsWith("/attachments/capability")) {
        capabilityReads++;
        return route.fulfill({ json: { ingest_enabled: enabled } });
      }
      if (path.includes("/attachments/")) uploads++;
      return route.fulfill({ json: { notifications: [], results: [] } });
    });
    await page.goto("/app/records");
    const supportsBlobStorage = await page.evaluate(async () => {
      const name = "attachment-browser-capability";
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("probe");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const available = await new Promise<boolean>((resolve) => {
        const transaction = db.transaction("probe", "readwrite");
        transaction.objectStore("probe").put(new Blob(["synthetic"]), "blob");
        transaction.oncomplete = () => resolve(true);
        transaction.onabort = () => resolve(false);
        transaction.onerror = () => resolve(false);
      });
      db.close();
      indexedDB.deleteDatabase(name);
      return available;
    });
    await page.locator("#records-unlock").click();
    await page.getByLabel("本地口令").fill("synthetic-local-passphrase");
    await page
      .getByRole("dialog", { name: "解锁本地资料" })
      .getByRole("button", { name: "解锁资料", exact: true })
      .click();
    await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
      "本地附件测试",
    );
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加笔记附件" });
    await expect(dialog).toContainText("服务端未启用附件上传");
    await expect(
      dialog.getByRole("button", { name: "加入附件队列" }),
    ).toBeDisabled();
    expect(uploads).toBe(0);
    enabled = true;
    await dialog.getByRole("button", { name: "重新检查上传能力" }).click();
    await expect(dialog).toContainText("服务端已启用附件上传");
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await dialog.screenshot({
      path: test.info().outputPath("attachment-preflight.png"),
    });
    enabled = false;
    const attachmentFile = test.info().outputPath("local.txt");
    await writeFile(attachmentFile, "synthetic", "utf8");
    await dialog
      .getByLabel("附件", { exact: true })
      .setInputFiles(attachmentFile);
    await dialog.getByRole("button", { name: "加入附件队列" }).click();
    await expect(dialog.getByRole("alert")).toContainText("附件未加入队列");
    expect(uploads).toBe(0);
    offline = true;
    // WebKit setOffline also blocks reading local Blob bytes. Reject HTTP requests
    // and dispatch the real offline event while keeping local file I/O available.
    if (browserName === "webkit") {
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => false,
        });
        window.dispatchEvent(new Event("offline"));
      });
    } else await page.context().setOffline(true);
    await expect(dialog).toContainText("当前离线");
    const reads = capabilityReads;
    await expect(
      dialog.getByRole("button", { name: "加入附件队列" }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox", { name: /仅在本地暂存/ }).check();

    await dialog.getByRole("button", { name: "加入附件队列" }).click();
    if (supportsBlobStorage) {
      await expect(dialog).not.toBeVisible();
      await expect(
        page
          .getByTestId("records-attachments")
          .getByText("local.txt", { exact: true }),
      ).toHaveCount(1);
    } else {
      test.info().annotations.push({
        type: "environment",
        description:
          "IndexedDB Blob storage unavailable: verified rejection feedback, not successful staging.",
      });
      await expect(dialog.getByRole("alert")).toContainText("附件未加入队列");
      await expect(
        dialog.getByRole("button", { name: "加入附件队列" }),
      ).toBeEnabled();
      await expect(
        page
          .getByTestId("records-attachments")
          .getByText("local.txt", { exact: true }),
      ).toHaveCount(0);
    }
    expect(offlineRequests).toBe(0);
    expect(capabilityReads).toBe(reads);
    expect(uploads).toBe(0);
    offline = false;
    if (browserName === "webkit") {
      await page.evaluate(() => {
        Object.defineProperty(navigator, "onLine", {
          configurable: true,
          get: () => true,
        });
        window.dispatchEvent(new Event("online"));
      });
    } else await page.context().setOffline(false);
  });
}
