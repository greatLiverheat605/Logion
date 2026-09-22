import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, reauthenticateForSensitiveJourney, test } from "./fixtures";

test.describe("interoperability hub real flows", () => {
  test.describe.configure({ mode: "serial" });

  test("M08 data workbench previews without writes and commits a new private note", async ({
    accountState,
    page,
  }) => {
    await reauthenticateForSensitiveJourney(page, accountState);
    await page.goto("/app/data");
    const workspaces = await page.request.get("/api/v1/workspaces");
    expect(workspaces.ok()).toBe(true);
    const workspace = (await workspaces.json()).workspaces[0].id as string;
    const spaces = await page.request.get(
      `/api/v1/workspaces/${workspace}/spaces`,
    );
    expect(spaces.ok()).toBe(true);
    const privateSpace = (await spaces.json()).spaces.find(
      (space: { visibility: string }) => space.visibility === "private",
    ).id as string;
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "logion_csrf",
    )!.value;
    const headers = {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": csrf,
    };
    const marker = `M08-import-${randomUUID()}`;
    const sourceId = randomUUID();
    const content = JSON.stringify({
      schema_version: "logion-export-v1",
      objects: {
        notes: [{ id: sourceId, title: marker, markdown_body: marker }],
        tasks: [{ id: randomUUID(), title: "Unsupported synthetic task" }],
      },
    });
    const search = async () => {
      const response = await page.request.post(
        `/api/v1/workspaces/${workspace}/search`,
        { headers, data: { query: marker, object_types: ["note"], limit: 10 } },
      );
      expect(response.ok()).toBe(true);
      return (await response.json()).results as Array<{ object_id: string }>;
    };
    expect(await search()).toEqual([]);
    await page
      .getByRole("button", { name: "生成导入预览", exact: true })
      .click();
    const sheet = page.getByRole("dialog", { name: "生成导入预览" });
    await sheet.getByLabel("格式").selectOption("logion_json");
    await sheet.getByLabel("文件名").fill(`${marker}.json`);
    await sheet.getByLabel("内容（最多 1 MiB）").fill(content);
    const previewResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/data-imports/preview"),
    );
    await sheet.getByRole("button", { name: "生成预览", exact: true }).click();
    const response = await previewResponse;
    expect(response.status()).toBe(201);
    const preview = await response.json();
    expect(preview).toMatchObject({
      status: "previewed",
      counts: { note: 1 },
      warnings: ["Skipped unsupported object type: tasks"],
      source_sha256: createHash("sha256").update(content).digest("hex"),
    });
    expect(preview.counts).toEqual({ note: 1 });
    await expect(sheet).toHaveCount(0);
    await page.getByRole("tab", { name: /导入预览/ }).click();
    await page.getByRole("button", { name: new RegExp(marker) }).click();
    const detail = page.getByTestId("data-import-detail");
    await expect(detail).toContainText(preview.source_sha256);
    const confirm = detail.getByRole("button", {
      name: "确认写入 Private Space",
    });
    await expect(confirm).toBeDisabled();
    expect(await search()).toEqual([]);
    await detail
      .getByLabel("写入自己的 Private Space")
      .selectOption(privateSpace);
    const committedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith(`/data-imports/${preview.id}/commit`),
    );
    await confirm.click();
    const committed = await committedResponse;
    expect(committed.status()).toBe(200);
    expect(await committed.json()).toMatchObject({
      id: preview.id,
      status: "imported",
      imported_space_id: privateSpace,
    });
    await expect(confirm).toHaveCount(0);
    const results = await search();
    expect(results).toHaveLength(1);
    expect(results[0].object_id).not.toBe(sourceId);
    await page.reload();
    await page.getByRole("tab", { name: /导入预览/ }).click();
    await page.getByRole("button", { name: new RegExp(marker) }).click();
    await expect(detail).toContainText("imported");
    await expect(confirm).toHaveCount(0);
    expect(await search()).toEqual(results);
  });

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
    await expect(
      page.getByTestId("workbench-frame").getByText("已切换到「考」画像。"),
    ).toBeVisible();
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
        page
          .getByTestId("workbench-frame")
          .getByText(`已切换到「${personaName}」画像。`),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "打开互操作中心" }),
      ).toBeVisible();
    }
  });

  test("creates, copies, closes and revokes a one-time Calendar URL", async ({
    accountState,
    page,
  }) => {
    await reauthenticateForSensitiveJourney(page, accountState);
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
    accountState,
    page,
  }) => {
    await reauthenticateForSensitiveJourney(page, accountState);
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
    accountState,
    page,
  }) => {
    await reauthenticateForSensitiveJourney(page, accountState);
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
    await expect(page.getByTestId("integrations-export")).toContainText(
      "下载后为可读 ZIP，未加密，请妥善保管。",
    );
    await page.getByRole("button", { name: "创建数据导出" }).click();
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
    await page.getByRole("button", { name: "创建数据导出" }).click();
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
    const exportRow = page.locator(`[data-export-id="${created.id}"]`);
    await expect(
      exportRow.getByRole("button", { name: "下载", exact: true }),
    ).toBeEnabled();

    const exportMetadata = await exportRow.locator("small").textContent();
    const sha256 = exportMetadata?.match(/[a-f0-9]{64}/)?.[0];
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
    const downloadPromise = page.waitForEvent("download");
    await exportRow.getByRole("button", { name: "下载", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(
      `logion-export-${created.id}.zip`,
    );
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
        "import json,sys,zipfile,tempfile,pathlib; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; d=tempfile.TemporaryDirectory(); z.extractall(d.name); p=pathlib.Path(d.name); m=json.loads((p/'manifest.json').read_text(encoding='utf-8')); data=json.loads((p/'data.json').read_text(encoding='utf-8')); assert m['counts']=={k:len(v) for k,v in data['objects'].items()}; print(json.dumps({'names':sorted(z.namelist()),'manifest':m})); d.cleanup()",
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

    await page.goto("/app/data");
    const detail = page.getByTestId("data-export-detail");
    const dataDownload = detail.getByRole("button", {
      name: "下载 ZIP",
      exact: true,
    });
    await expect(dataDownload).toBeEnabled();
    const secondDownload = page.waitForEvent("download");
    await dataDownload.click();
    const second = await secondDownload;
    expect(second.suggestedFilename()).toBe(`logion-export-${created.id}.zip`);
    expect(
      createHash("sha256")
        .update(readFileSync((await second.path())!))
        .digest("hex"),
    ).toBe(sha256);
  });

  for (const route of ["/app/data", "/app/integrations"] as const) {
    test(`export lifetime and rejected download stay inside ${route}`, async ({
      page,
    }) => {
      let expiresAt = new Date(Date.now() + 60_000).toISOString();
      let failure = "EXPORT_NOT_FOUND";
      let attempts = 0;
      await page.route(
        "**/api/v1/workspaces/*/data-exports",
        async (request) => {
          const workspace = new URL(request.request().url()).pathname.split(
            "/",
          )[4];
          await request.fulfill({
            json: {
              exports: [
                {
                  id: "11111111-1111-4111-8111-111111111111",
                  workspace_id: workspace,
                  status: "succeeded",
                  created_at: new Date().toISOString(),
                  completed_at: new Date().toISOString(),
                  expires_at: expiresAt,
                  artifact_bytes: 10,
                  artifact_sha256: "a".repeat(64),
                  schema_version: "logion-export-v1",
                  version: 1,
                  error_code: null,
                },
              ],
            },
          });
        },
      );
      await page.route(
        "**/api/v1/workspaces/*/data-exports/*/download",
        async (request) => {
          attempts++;
          await request.fulfill({
            status:
              failure === "EXPORT_NOT_FOUND"
                ? 404
                : failure === "AUTH_INVALID_SESSION"
                  ? 401
                  : 403,
            json: {
              code: failure,
              message: "Synthetic refusal",
              request_id: "m05-download",
              retryable: false,
            },
          });
        },
      );
      const open = async () => {
        await page.goto(route);
        if (route === "/app/integrations")
          await page.getByRole("button", { name: /导出任务/ }).click();
      };
      const button = page.getByRole("button", {
        name: route === "/app/data" ? "下载 ZIP" : "下载",
        exact: true,
      });
      let downloads = 0;
      page.on("download", () => {
        downloads++;
      });
      await open();
      await button.click();
      await expect(
        page.getByText("导出已不可用，可能已过期；请重新读取或创建导出。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(button).toBeDisabled();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      failure = "AUTH_RECENT_LOGIN_REQUIRED";
      await open();
      await button.click();
      await expect(
        page.getByText("下载需要近期认证，请重新登录后重试。", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "重新登录", exact: true }),
      ).toHaveAttribute(
        "href",
        `/auth/login?next=${encodeURIComponent(route)}`,
      );
      failure = "AUTH_INVALID_SESSION";
      await open();
      await button.click();
      await expect(
        page.getByText("会话需要恢复，请完成登录恢复后重试下载。", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${route}$`));
      expect(attempts).toBe(3);
      expect(downloads).toBe(0);
      expiresAt = new Date(Date.now() + 3000).toISOString();
      await open();
      await expect(button).toBeEnabled();
      await expect(button).toBeDisabled({ timeout: 5000 });
      await expect(
        page.getByText("已过期，请重新创建导出。", { exact: true }),
      ).toBeVisible();
      expect(attempts).toBe(3);
    });
  }

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
