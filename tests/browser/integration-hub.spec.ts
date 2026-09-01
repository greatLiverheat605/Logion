import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test } from "./fixtures";

test.describe("interoperability hub real flows", () => {
  test.describe.configure({ mode: "serial" });

  test("keeps discovery persona-aware while allowing direct access", async ({
    page,
  }) => {
    await page.goto("/app/settings");
    await expect(
      page.getByRole("link", { name: "打开互操作中心" }),
    ).toBeVisible();

    await page.keyboard.press("Control+k");
    await expect(
      page.getByRole("link", {
        name: "打开互操作中心 汇总只读日历与开放格式迁移能力 打开",
      }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /^切换到：考，/ }).click();
    await expect(page.getByText("已切换到「考」画像。")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "打开互操作中心" }),
    ).toHaveCount(0);
    await page.goto("/app/integrations");
    await expect(page.locator("h1")).toContainText("把已有数据能力连接起来");

    for (const personaName of ["研", "导", "学"]) {
      await page.goto("/app/settings");
      await page
        .getByRole("button", { name: new RegExp(`^切换到：${personaName}，`) })
        .click();
      await expect(
        page.getByText(`已切换到「${personaName}」画像。`),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "打开互操作中心" }),
      ).toBeVisible();
    }
  });

  test("creates, copies, closes and revokes a one-time Calendar URL", async ({
    page,
  }) => {
    const context = page.context();
    await page.goto("/app/integrations");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const name = `浏览器日历 ${randomUUID().slice(0, 8)}`;
    await page.getByLabel("订阅名称").fill(name);
    await page.getByRole("button", { name: "创建日历订阅" }).click();

    const tokenLink = page.getByRole("link", {
      name: /\/api\/v1\/calendars\//,
    });
    await expect(tokenLink).toBeVisible();
    const oneTimeUrl = await tokenLink.getAttribute("href");
    expect(oneTimeUrl).toMatch(/^\/api\/v1\/calendars\/[A-Za-z0-9_-]+\.ics$/);
    await expect(page.getByTestId("calendar-token-notice")).toBeFocused();

    await page.getByRole("button", { name: "复制一次性 URL" }).click();
    await expect(
      page.getByText("一次性 Calendar URL 已复制到剪贴板。"),
    ).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
      oneTimeUrl,
    );

    await page.getByRole("button", { name: "关闭一次性 URL" }).click();
    await expect(tokenLink).toHaveCount(0);
    await expect(page.getByLabel("订阅名称")).toBeFocused();
    expect((await page.request.get(oneTimeUrl ?? "")).status()).toBe(200);

    const row = page.locator("li").filter({ hasText: name });
    await row.getByRole("button", { name: "撤销" }).click();
    await expect(row.getByText("revoked")).toBeVisible();
    expect((await page.request.get(oneTimeUrl ?? "")).status()).toBe(404);
  });

  test("previews Markdown and commits only to the owned Private Space", async ({
    page,
  }) => {
    await page.goto("/app/integrations");
    await page.getByRole("button", { name: /导入预览/ }).click();
    const marker = `import-${randomUUID()}`;
    await page.getByLabel("格式").selectOption("markdown");
    await page.getByLabel("文件名").fill(`${marker}.md`);
    await page.getByLabel("内容（最大 1 MiB）").fill(`# Imported\n\n${marker}`);
    await page.getByRole("button", { name: "生成导入预览" }).click();

    const target = page.getByLabel("写入自己的 Private Space");
    await expect(target.locator("option")).not.toHaveCount(0);
    await expect(target).not.toHaveValue("");
    const row = page.locator("li").filter({ hasText: `${marker}.md` });
    await expect(row.getByText("previewed", { exact: false })).toBeVisible();
    await row.getByRole("button", { name: "确认 IMPORT" }).click();
    await expect(row.getByText("imported", { exact: false })).toBeVisible();
  });

  test("surfaces the recent-auth gate, then downloads and verifies an export", async ({
    page,
  }) => {
    await page.goto("/app/integrations");
    await page.getByRole("button", { name: /导出任务/ }).click();
    let rejectOnce = true;
    const exportCollection = "**/api/v1/workspaces/*/data-exports";
    await page.route(exportCollection, async (route) => {
      if (route.request().method() === "POST" && rejectOnce) {
        rejectOnce = false;
        await route.fulfill({
          contentType: "application/json",
          json: {
            code: "AUTH_RECENT_LOGIN_REQUIRED",
            message: "Recent authentication is required.",
            request_id: "browser-recent-auth-gate",
            retryable: false,
          },
          status: 403,
        });
        return;
      }
      await route.fallback();
    });

    const confirmation = page.getByLabel("输入 EXPORT 确认创建");
    await confirmation.fill("EXPORT");
    await page.getByRole("button", { name: "创建加密导出" }).click();
    await expect(page.getByText("此操作需要重新登录后继续。")).toBeVisible();
    await expect(page.getByText(/browser-recent-auth-gate/)).toBeVisible();

    await page.unroute(exportCollection);
    await confirmation.fill("EXPORT");
    const createdResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/data-exports") &&
        response.status() === 202,
    );
    await page.getByRole("button", { name: "创建加密导出" }).click();
    const created = (await (await createdResponse).json()) as { id: string };
    await expect(page.getByText("导出任务已进入后台队列。")).toBeVisible();

    await expect
      .poll(
        () =>
          page.evaluate(async (exportId) => {
            const workspaceId = (
              (await fetch("/api/v1/workspaces").then((response) =>
                response.json(),
              )) as { workspaces: Array<{ id: string }> }
            ).workspaces[0]?.id;
            if (!workspaceId) return "missing-workspace";
            const result = (await fetch(
              `/api/v1/workspaces/${workspaceId}/data-exports`,
            ).then((response) => response.json())) as {
              exports: Array<{ id: string; status: string }>;
            };
            return result.exports.find((item) => item.id === exportId)?.status;
          }, created.id),
        { timeout: 30_000 },
      )
      .toBe("succeeded");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /导出任务/ }).click();
    const exportRow = page.locator("li").filter({
      has: page.locator(`a[href*="${created.id}"]`),
    });
    await expect(exportRow.getByRole("link", { name: "下载" })).toBeVisible();

    const exportMetadata = await exportRow.locator("small").textContent();
    const sha256 = exportMetadata?.match(/[a-f0-9]{64}/)?.[0];
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    const downloadPromise = page.waitForEvent("download");
    await exportRow.getByRole("link", { name: "下载" }).click();
    const download = await downloadPromise;
    const artifactPath = await download.path();
    expect(artifactPath).not.toBeNull();
    const bytes = readFileSync(artifactPath ?? "");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);

    const inspected = spawnSync(
      "uv",
      [
        "run",
        "python",
        "-c",
        "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'names':sorted(z.namelist()),'manifest':json.loads(z.read('manifest.json'))}))",
        artifactPath ?? "",
      ],
      { encoding: "utf8" },
    );
    expect(inspected.status, inspected.stderr).toBe(0);
    const archive = JSON.parse(inspected.stdout) as {
      manifest: { excluded: string[]; product: string; schema_version: string };
      names: string[];
    };
    expect(archive.names).toEqual([
      "data.json",
      "manifest.json",
      "notes.md",
      "papers.bib",
      "tasks.csv",
    ]);
    expect(archive.manifest).toMatchObject({
      product: "Logion",
      schema_version: "logion-export-v1",
    });
    expect(archive.manifest.excluded).toContain("credentials");
  });

  test("renders missing-context, API-error and unsupported boundaries honestly", async ({
    page,
  }) => {
    await page.route("**/api/v1/workspaces", (route) =>
      route.fulfill({
        contentType: "application/json",
        json: { workspaces: [] },
      }),
    );
    await page.goto("/app/integrations");
    await expect(page.getByText("尚无可访问工作区")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "第三方账号连接" }),
    ).toBeVisible();
    await expect(
      page.getByText("Zotero 账号同步与 OAuth 尚未开放。"),
    ).toBeVisible();
    await page.unroute("**/api/v1/workspaces");

    await page.route("**/api/v1/workspaces/*/calendar-feeds", (route) =>
      route.fulfill({
        contentType: "application/json",
        json: {
          code: "BROWSER_FORCED_FAILURE",
          message: "Forced browser error boundary.",
          request_id: "browser-error-boundary",
          retryable: true,
        },
        status: 503,
      }),
    );
    await page.goto("/app/integrations");
    await expect(page.getByText("互操作状态暂时不可用")).toBeVisible();
    await expect(page.getByText(/BROWSER_FORCED_FAILURE/)).toBeVisible();
    await expect(page.getByText(/browser-error-boundary/)).toBeVisible();
  });
});
