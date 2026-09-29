import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function selectFirstPassage(page: Page) {
  const layer = page.locator(
    '[data-pdf-page="1"] [data-reader-text-layer="true"]',
  );
  await expect(layer).toContainText("careful reading");
  await layer.evaluate((element) => {
    const span = [...element.querySelectorAll("span[data-text-start]")].find(
      (node) => node.textContent?.includes("careful reading"),
    )!;
    (element.closest(".wb-pane-content") as HTMLElement).focus();
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

test("selection commands preserve source citations and use the real AI draft pipeline", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const { readFile } = await import("node:fs/promises");
  expect(
    (
      await context.request.post("/api/v1/auth/register", {
        headers: { Origin: baseURL! },
        data: {
          email: `actions-${randomUUID()}@example.com`,
          password: `${randomBytes(24).toString("base64url")}Aa1!`,
          device_name: "Synthetic reading actions",
        },
      })
    ).status(),
  ).toBe(201);
  const headers = {
    Origin: baseURL!,
    "X-CSRF-Token": (await context.cookies()).find(
      (c) => c.name === "logion_csrf",
    )!.value,
  };
  const workspace = (
    await (await context.request.get("/api/v1/workspaces")).json()
  ).workspaces[0].id;
  const space = (
    await (
      await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
    ).json()
  ).spaces[0].id;
  const scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
  for (const [method, path, data] of [
    [
      "put",
      "/api/v1/research/integrations/webdav",
      { username: "synthetic-account", credential: "synthetic-webdav" },
    ],
    ["post", "/api/v1/research/integrations/webdav/test", {}],
  ] as const)
    expect(
      (await context.request[method](path, { headers, data })).status(),
    ).toBe(200);
  const resource = await (
    await context.request.post(`${scope}/library/resources/pdf-import`, {
      headers: {
        ...headers,
        "Content-Type": "application/pdf",
        "X-PDF-Title": "Synthetic selection paper",
      },
      data: await readFile("tests/fixtures/synthetic-reader.pdf"),
    })
  ).json();
  expect(resource.id).toBeTruthy();
  const ai = `/api/v1/workspaces/${workspace}/ai`;
  const providerId = randomUUID();
  expect(
    (
      await context.request.post(`${ai}/providers`, {
        headers,
        data: {
          id: providerId,
          name: "Synthetic provider",
          provider_type: "openai_compatible",
          base_url: "https://api.example.com/v1",
          credential: "synthetic-provider",
          enabled: true,
          timeout_seconds: 30,
          max_retries: 0,
        },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await context.request.post(
        `${ai}/providers/${providerId}/discover-models`,
        { headers },
      )
    ).status(),
  ).toBe(200);
  const models = [];
  const discovered = (await (await context.request.get(`${ai}/models`)).json())
    .models as { id: string; provider_model_id: string; version: number }[];
  for (const tier of ["economical", "quality"]) {
    const selected = discovered.find(
      (item) => item.provider_model_id === `synthetic-${tier}`,
    )!;
    const model = await context.request.put(`${ai}/models/${selected.id}`, {
      headers,
      data: {
        expected_version: selected.version,
        display_name: tier,
        enabled: true,
        supports_json: true,
        supports_stream: false,
        context_window: 32000,
        pricing_currency: "USD",
        input_cost_per_million_minor: 1,
        output_cost_per_million_minor: 1,
      },
    });
    expect(model.status()).toBe(200);
    models.push((await model.json()).id);
  }
  expect(
    (
      await context.request.post(
        `/api/v1/workspaces/${workspace}/research/ai/presets`,
        {
          headers,
          data: {
            economical_model_ids: models.slice(0, 1),
            quality_model_ids: models.slice(1),
          },
        },
      )
    ).status(),
  ).toBe(201);
  expect(
    (
      await context.request.post(`${scope}/research/ideas`, {
        headers,
        data: {
          title: "Synthetic private idea",
          body: "UNPUBLISHED_SYNTHETIC_IDEA_DO_NOT_SEND",
        },
      })
    ).status(),
  ).toBe(201);
  const stored = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/${resource.id}/text`) &&
      r.request().method() === "POST",
  );
  await page.goto(`/read/${resource.id}`);
  expect((await stored).status()).toBe(200);
  await page.getByRole("button", { name: "知道了" }).click();
  await selectFirstPassage(page);
  await expect(page.getByRole("toolbar", { name: "选中文字操作" })).toHaveCount(
    0,
  );
  await page.keyboard.press("h");
  await expect(
    page.getByRole("status").filter({ hasText: "摘录已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "选择右栏内容" }).click();
  await page.getByRole("menuitem", { name: "精读笔记" }).click();
  await page.getByRole("button", { name: "创建精读笔记" }).click();
  await page.getByText("完整 Markdown 与自定义内容", { exact: true }).click();
  const editor = page.getByRole("textbox", { name: "精读笔记正文" });
  const notePath = `${scope}/library/resources/${resource.id}/note`;
  const savedNote = page.waitForResponse(
    (r) =>
      r.url().endsWith("/note/document") && r.request().method() === "PATCH",
  );
  await editor.fill(
    (await editor.inputValue()).replace(
      "## 动机\n",
      "## 动机\nOwner motivation and evidence\n",
    ),
  );
  expect((await savedNote).status()).toBe(200);
  await expect(
    page.getByRole("status").filter({ hasText: /^已保存$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "发送原文并起草缺失章节" }).click();
  await expect(page.getByRole("heading", { name: "待确认草稿" })).toBeVisible();
  expect(await editor.inputValue()).not.toContain("Synthetic explanation");
  // The note draft loads independently of PDF extraction. Finish the reloaded
  // source upload before this scenario deliberately takes the browser offline.
  const reloadedText = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/${resource.id}/text`) &&
      r.request().method() === "POST",
  );
  await page.reload();
  expect((await reloadedText).status()).toBe(200);
  await page.getByText("完整 Markdown 与自定义内容", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "待确认草稿" })).toBeVisible();
  await page.getByRole("button", { name: "接受并写入笔记" }).click();
  await expect(editor).toHaveValue(/Synthetic explanation/);
  await expect(editor).toHaveValue(/Owner motivation and evidence/);
  const acceptedNote = await (await context.request.get(notePath)).json();
  expect(acceptedNote.missing_sections).toEqual([]);
  await context.setOffline(true);
  const unsaved =
    (await editor.inputValue()) + "\nOffline draft stays in this page.";
  await editor.fill(unsaved);
  await expect(
    page.locator(".wb-close-reading").getByRole("alert"),
  ).toContainText("需要联网");
  await context.setOffline(false);
  expect(await editor.inputValue()).toBe(unsaved);
  const retried = page.waitForResponse(
    (r) =>
      r.url().endsWith("/note/document") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "重试保存" }).click();
  expect((await retried).status()).toBe(200);
  await editor.press("Control+Home");
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(350);
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 768)
      await page.getByRole("radio", { name: "右 · 精读笔记" }).click();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`note-${width}-${theme}.png`),
      });
    }
  }
  await expectOnlineOnly(page);
  const excerpts = await (
    await context.request.get(
      `${scope}/library/resources/${resource.id}/excerpts`,
    )
  ).json();
  expect(excerpts.excerpts).toHaveLength(1);
  expect(excerpts.excerpts[0].page_start).toBe(1);
  expect(excerpts.excerpts[0].excerpt_text).toContain("careful reading");
  // Hold the resulting pane preference save: success must mean the command
  // gate is ready for the next selection action, not only that the POST ended.
  let releaseLayout!: () => void;
  let layoutStarted!: () => void;
  const layoutHeld = new Promise<void>((resolve) => {
    releaseLayout = resolve;
  });
  const layoutRequest = new Promise<void>((resolve) => {
    layoutStarted = resolve;
  });
  const settingsPath = "**/api/v1/users/me/settings";
  await page.route(settingsPath, async (route) => {
    if (route.request().method() === "PUT") {
      layoutStarted();
      await layoutHeld;
    }
    await route.continue();
  });
  try {
    await selectFirstPassage(page);
    await page.keyboard.press("c");
    await layoutRequest;
    await expect(
      page.getByRole("status").filter({ hasText: "正在处理选中内容" }),
    ).toBeVisible();
    expect(
      await page.getByRole("status").filter({ hasText: "概念已创建" }).count(),
    ).toBe(0);
  } finally {
    releaseLayout();
    await page.unrouteAll({ behavior: "wait" });
  }
  await expect(
    page.getByRole("status").filter({ hasText: "概念已创建" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "正在处理选中内容" }),
  ).toHaveCount(0);
  await selectFirstPassage(page);
  await page.keyboard.press("t");
  await expect(page.getByRole("region", { name: "AI 阅读草稿" })).toContainText(
    "Synthetic translated passage",
  );
  await selectFirstPassage(page);
  await page.keyboard.press("Control+k");
  await page.getByLabel("搜索指令").fill("解释选中文字");
  await page.getByRole("option", { name: "解释选中文字" }).click();
  await expect(page.getByRole("region", { name: "AI 阅读草稿" })).toContainText(
    "Synthetic explanation",
  );
  await selectFirstPassage(page);
  await page.keyboard.press("q");
  const input = page.getByLabel("关于这段原文的问题");
  await input.fill("What is the motivation?");
  await page.keyboard.type("theqc");
  await expect(input).toHaveValue("What is the motivation?theqc");
  expect(
    (
      await (
        await context.request.get(
          `${scope}/library/resources/${resource.id}/excerpts`,
        )
      ).json()
    ).excerpts,
  ).toHaveLength(1);
  await page.getByRole("button", { name: "发送问题与引用" }).click();
  await expect(page.getByRole("region", { name: "AI 阅读草稿" })).toContainText(
    "Synthetic explanation",
  );
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      if (width < 768)
        await page.getByRole("radio", { name: "右 · AI 对话" }).click();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`selection-${width}-${theme}.png`),
      });
    }
  }
  await expectOnlineOnly(page);
  expect(
    (
      await context.request.put("/api/v1/users/me/settings", {
        headers,
        data: {
          settings: [
            {
              key: "reader.selection_menu",
              value: "true",
              version: 0,
            },
          ],
        },
      })
    ).status(),
  ).toBe(200);
  const ready = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/${resource.id}/text`) &&
      r.request().method() === "POST",
  );
  await page.reload();
  expect((await ready).status()).toBe(200);
  if (page.viewportSize()!.width < 768)
    await page.getByRole("radio", { name: "中 · PDF 原文" }).click();
  await selectFirstPassage(page);
  await expect(
    page.getByRole("toolbar", { name: "选中文字操作" }),
  ).toBeVisible();
  await page
    .getByRole("toolbar", { name: "选中文字操作" })
    .getByRole("button", { name: "摘录 H" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "摘录已保存" }),
  ).toBeVisible();
});

async function expectOnlineOnly(page: Page) {
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(
    await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    ),
  ).toBe(0);
}

test("owner configures and revokes encrypted integrations through local fake services", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const registration = await context.request.post("/api/v1/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `integration-browser-${randomUUID()}@example.com`,
      password: `${randomBytes(24).toString("base64url")}Aa1!`,
      device_name: "Synthetic integration browser",
    },
  });
  expect(registration.status()).toBe(201);
  await page.goto("/settings");
  const zotero = page.getByRole("region", { name: "Zotero 集成" });
  await zotero.getByRole("button", { name: "配置 Zotero" }).click();
  await zotero.getByLabel("只读 API Key").fill("synthetic-zotero");
  await zotero.getByRole("button", { name: "保存凭据" }).click();
  await expect(zotero.getByLabel("只读 API Key")).toHaveCount(0);
  await zotero.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(zotero.getByRole("status")).toHaveText("已连接");
  const dav = page.getByRole("region", { name: "坚果云 集成" });
  await dav.getByRole("button", { name: "配置 坚果云" }).click();
  await dav.getByLabel("坚果云账号").fill("synthetic-account");
  await dav.getByLabel("应用密码").fill("synthetic-webdav");
  await dav.getByRole("button", { name: "保存凭据" }).click();
  await dav.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(dav.getByRole("status")).toHaveText("已连接");
  const sync = page.getByRole("region", { name: "Zotero 文献同步" });
  await sync.getByRole("button", { name: "立即同步 Zotero" }).focus();
  await page.keyboard.press("Enter");
  await expect(sync.getByRole("status")).toContainText("最近同步：");
  await page.goto("/library");
  await expect(
    page.getByRole("button", { name: /Synthetic synchronized paper/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Synthetic synchronized paper/ }),
  ).toContainText("collection:Examples");
  await page.goto("/settings");
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["日间", "夜间"]) {
      await page.getByRole("radio", { name: theme, exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute(
        "data-theme",
        theme === "日间" ? "light" : "dark",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(
          `integrations-${width}-${theme === "日间" ? "light" : "dark"}.png`,
        ),
        fullPage: true,
      });
      await sync.scrollIntoViewIfNeeded();
      await expect(
        sync.getByRole("button", { name: "立即同步 Zotero" }),
      ).toBeInViewport();
      await sync.screenshot({
        path: testInfo.outputPath(
          `sync-${width}-${theme === "日间" ? "light" : "dark"}.png`,
        ),
      });
    }
  }
  await page.reload();
  await expect(zotero.getByRole("status")).toHaveText("已连接");
  await zotero.getByRole("button", { name: "撤销连接" }).click();
  await page.getByRole("button", { name: "确认撤销" }).click();
  await expect(zotero.getByRole("status")).toHaveText("未配置");
  const state = await context.request.get(
    "/api/v1/research/integrations/webdav",
  );
  expect(Object.keys(await state.json()).sort()).toEqual([
    "configured",
    "connected",
    "last_error_code",
    "last_sync_at",
    "provider",
  ]);
  expect(await state.text()).not.toContain("synthetic");
  await expectOnlineOnly(page);
});

test("real research API persists literature and preferences, rejects conflicts and gates disabled routes", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const origin = baseURL!;
  const credentials = {
    email: `research-browser-${randomUUID()}@example.com`,
    password: `${randomBytes(24).toString("base64url")}Aa1!`,
    device_name: "Synthetic research browser",
  };
  const registration = await context.request.post("/api/v1/auth/register", {
    headers: { Origin: origin },
    data: credentials,
  });
  expect(registration.status()).toBe(201);
  await page.goto("/library");
  await expect(
    page.getByRole("heading", { name: "文献库", exact: true }),
  ).toBeVisible();
  const title = "真实 API 合成文献";
  const doi = `10.1234/${randomUUID()}`;
  await page.getByRole("button", { name: "新建文献" }).click();
  const dialog = page.getByRole("dialog", { name: "新建文献" });
  await dialog.getByLabel("标题", { exact: true }).fill(title);
  await dialog.getByLabel("DOI", { exact: true }).fill(doi);
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith("/library/resources"),
  );
  await dialog.getByRole("button", { name: "保存文献" }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const resource = await createdResponse.json();
  const libraryPath = new URL(createdResponse.url()).pathname;
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();

  await page.getByRole("button", { name: "新建文献" }).click();
  await dialog
    .getByLabel("标题", { exact: true })
    .fill("重复 DOI 的输入须保留");
  await dialog.getByLabel("DOI", { exact: true }).fill(doi);
  const duplicate = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(libraryPath),
  );
  await dialog.getByRole("button", { name: "保存文献" }).click();
  const duplicateResponse = await duplicate;
  expect(duplicateResponse.status()).toBe(409);
  expect((await duplicateResponse.json()).details.existing_id).toBe(
    resource.id,
  );
  await expect(dialog.getByRole("alert")).toContainText("已有条目");
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
    "重复 DOI 的输入须保留",
  );
  await expect(dialog.getByLabel("DOI", { exact: true })).toHaveValue(doi);
  await page.reload();
  await expect(
    page.getByRole("button", { name: new RegExp(title) }),
  ).toBeVisible();
  const persisted = await context.request.get(libraryPath);
  expect(persisted.status()).toBe(200);
  expect(
    (await persisted.json()).resources.map((item: { id: string }) => item.id),
  ).toEqual([resource.id]);

  await page.getByRole("button", { name: "外观", exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().endsWith("/users/me/settings"),
  );
  await page.getByRole("menuitem", { name: "夜间", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const current = await context.request.get(
    "/api/v1/users/me/settings?key=appearance.theme",
  );
  expect(current.status()).toBe(200);
  const setting = (await current.json()).settings[0];
  expect(setting.value).toBe('"dark"');
  expect(setting.version).toBe(1);
  // Prove the saved theme is in server HTML, before any hydration can run.
  const noScript = await browser.newContext({
    baseURL: origin,
    javaScriptEnabled: false,
    colorScheme: "light",
    storageState: await context.storageState(),
  });
  try {
    const firstPaint = await noScript.newPage();
    await firstPaint.goto("/library");
    await expect(firstPaint.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
  } finally {
    await noScript.close();
  }
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )!.value;
  const stale = await context.request.put("/api/v1/users/me/settings", {
    headers: { Origin: origin, "X-CSRF-Token": csrf },
    data: {
      settings: [
        { key: setting.key, value: '"light"', version: setting.version - 1 },
      ],
    },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("USER_SETTING_VERSION_CONFLICT");
  await page.goto(`/read/${resource.id}`);
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(
    page.getByRole("complementary", { name: "阅读工具提示" }),
  ).toHaveCount(0);
  await expectOnlineOnly(page);

  // No storageState copy: independently authenticate in an empty browser context.
  const fresh = await browser.newContext({ baseURL: origin });
  try {
    const login = await fresh.request.post("/api/v1/auth/login", {
      headers: { Origin: origin },
      data: credentials,
    });
    expect(login.status()).toBe(200);
    const other = await fresh.newPage();
    await other.goto("/library");
    await expect(
      other.getByRole("button", { name: new RegExp(title) }),
    ).toBeVisible();
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await other.goto(`/read/${resource.id}`);
    await expect(
      other.getByRole("region", { name: "三栏阅读布局" }),
    ).toBeVisible();
    await expect(
      other.getByRole("complementary", { name: "阅读工具提示" }),
    ).toHaveCount(0);
    await expectOnlineOnly(other);
  } finally {
    await fresh.close();
  }
  const disabled = await context.request.get(
    `http://127.0.0.1:8001${libraryPath}`,
  );
  expect(disabled.status()).toBe(404);
  expect((await disabled.json()).code).toBe("NOT_FOUND");
});

test("local PDFs import through real WebDAV and deduplicate", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const registration = await context.request.post("/api/v1/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `pdf-browser-${randomUUID()}@example.com`,
      password: `${randomBytes(24).toString("base64url")}Aa1!`,
      device_name: "Synthetic PDF browser",
    },
  });
  expect(registration.status()).toBe(201);
  const cookies = await context.cookies();
  const csrf = cookies.find((cookie) => cookie.name === "logion_csrf")!.value;
  const headers = { Origin: baseURL!, "X-CSRF-Token": csrf };
  expect(
    (
      await context.request.put("/api/v1/research/integrations/webdav", {
        headers,
        data: { username: "synthetic-account", credential: "synthetic-webdav" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await (
        await context.request.post(
          "/api/v1/research/integrations/webdav/test",
          { headers },
        )
      ).json()
    ).connected,
  ).toBe(true);
  await page.goto("/library");
  const pdf = {
    name: "Synthetic imported paper.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nSynthetic import\n%%EOF"),
  };
  const second = {
    name: "Second paper.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nSecond import\n%%EOF"),
  };
  await page
    .getByLabel("选择 PDF 文件", { exact: true })
    .setInputFiles([pdf, second]);
  await expect(
    page.getByRole("list", { name: "导入结果" }).getByRole("listitem"),
  ).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /Synthetic imported paper/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Second paper/ })).toHaveCount(
    1,
  );
  await page.getByLabel("选择 PDF 文件", { exact: true }).setInputFiles(pdf);
  await expect(
    page.getByRole("list", { name: "导入结果" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /Synthetic imported paper/ }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: /Synthetic imported paper/ }).click();
  const folder = await mkdtemp(join(tmpdir(), "logion-pdf-fixture-"));
  try {
    await mkdir(join(folder, "nested"));
    await writeFile(
      join(folder, "nested", "Folder paper.pdf"),
      "%PDF-1.7\nSynthetic folder import\n%%EOF",
      { encoding: "utf8" },
    );
    await page.getByLabel("选择 PDF 文件夹").setInputFiles(folder);
    await expect(
      page.getByRole("button", { name: /Folder paper/ }),
    ).toHaveCount(1);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  const reader = await page
    .getByRole("link", { name: "进入阅读" })
    .getAttribute("href");
  const resourceId = reader!.split("/").at(-1);
  const workspace = (
    await (await context.request.get("/api/v1/workspaces")).json()
  ).workspaces[0].id;
  const space = (
    await (
      await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
    ).json()
  ).spaces[0].id;
  const downloaded = await context.request.get(
    `/api/v1/workspaces/${workspace}/spaces/${space}/library/resources/${resourceId}/pdf`,
  );
  expect(downloaded.status()).toBe(200);
  expect(await downloaded.body()).toEqual(pdf.buffer);
  expect(downloaded.headers()["content-security-policy"]).toBe("sandbox");
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`pdf-import-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page.getByRole("button", { name: "选择文件夹", exact: true }).focus();
  await expect(
    page.getByRole("button", { name: "选择文件夹", exact: true }),
  ).toBeFocused();
  expect(
    await page.getByLabel("选择 PDF 文件夹").getAttribute("webkitdirectory"),
  ).toBe("");
  await expectOnlineOnly(page);
});

test("PDF reader renders local assets, text, outline and thumbnails under nonce CSP", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const { readFile } = await import("node:fs/promises");
  const registered = await context.request.post("/api/v1/auth/register", {
    headers: { Origin: baseURL! },
    data: {
      email: `reader-${randomUUID()}@example.com`,
      password: `${randomBytes(24).toString("base64url")}Aa1!`,
      device_name: "Synthetic reader",
    },
  });
  expect(registered.status()).toBe(201);
  const csrf = (await context.cookies()).find(
    (c) => c.name === "logion_csrf",
  )!.value;
  const headers = { Origin: baseURL!, "X-CSRF-Token": csrf };
  expect(
    (
      await context.request.put("/api/v1/research/integrations/webdav", {
        headers,
        data: { username: "synthetic-account", credential: "synthetic-webdav" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await context.request.post("/api/v1/research/integrations/webdav/test", {
        headers,
      })
    ).status(),
  ).toBe(200);
  const workspace = (
    await (await context.request.get("/api/v1/workspaces")).json()
  ).workspaces[0].id;
  const space = (
    await (
      await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
    ).json()
  ).spaces[0].id;
  const base = `/api/v1/workspaces/${workspace}/spaces/${space}/library/resources`;
  const imported = await context.request.post(`${base}/pdf-import`, {
    headers: {
      ...headers,
      "Content-Type": "application/pdf",
      "X-PDF-Title": "Synthetic reader paper",
    },
    data: await readFile("tests/fixtures/synthetic-reader.pdf"),
  });
  expect(imported.status()).toBe(201);
  const resource = await imported.json();
  const outbound: string[] = [],
    errors: string[] = [],
    assetUrls: string[] = [];
  let pdfRequests = 0;
  const pdfOperations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().startsWith("http") &&
      new URL(request.url()).origin !== baseURL
    )
      outbound.push(request.url());
    if (request.url().endsWith(`/${resource.id}/pdf/prepare`)) {
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-csrf-token"]).toBeTruthy();
      pdfOperations.push("prepare");
    }
    if (request.url().endsWith(`/${resource.id}/pdf`)) {
      pdfRequests++;
      pdfOperations.push("read");
    }
    if (request.url().includes("/pdfjs/")) assetUrls.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    errors.push(dialog.message());
    await dialog.dismiss();
  });
  await page.addInitScript(() => {
    (window as unknown as { cspViolations: string[] }).cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { cspViolations: string[] }).cspViolations.push(
        event.violatedDirective,
      ),
    );
  });
  const textSaved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/${resource.id}/text`) &&
      r.request().method() === "POST",
  );
  await page.goto(`/read/${resource.id}`);
  const response = await textSaved;
  expect(response.status()).toBe(200);
  const fulltext = await response.json();
  expect(fulltext.normalization_version).toBe("utf8-nfc-lf-v1");
  expect(fulltext.page_offsets).toHaveLength(3);
  expect(fulltext.text).toContain("careful reading");
  await expect(
    page.locator('[data-pdf-page="1"] [data-reader-text-layer]'),
  ).toContainText("Motivation");
  await expect(page.locator('[data-pdf-page="1"]')).toHaveAttribute(
    "data-rendered",
    "true",
  );
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(
    page.getByRole("complementary", { name: "阅读工具提示" }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+f");
  await page.getByLabel("在原文中查找").fill("synthetic");
  await expect(page.locator(".wb-text-match").first()).toBeVisible();
  await page.getByRole("button", { name: "放大原文", exact: true }).click();
  await expect(page.getByText("110%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "缩小原文", exact: true }).click();
  await page.getByRole("button", { name: "选择左栏内容" }).click();
  await page.getByRole("menuitem", { name: "大纲", exact: true }).click();
  await page
    .getByRole("navigation", { name: "论文大纲" })
    .getByRole("button", { name: "Experiments" })
    .click();
  await expect(page.getByLabel("跳到页码")).toHaveValue("2");
  await page.getByRole("button", { name: "选择右栏内容" }).click();
  await page.getByRole("menuitem", { name: "缩略图", exact: true }).click();
  // Thumbnails render as their pane scrolls; visit every page before counting.
  const thumbnails = page.locator(".wb-pdf-thumbnail");
  await expect(thumbnails).toHaveCount(3);
  for (const thumbnail of await thumbnails.all()) {
    await thumbnail.scrollIntoViewIfNeeded();
    await expect(thumbnail).toHaveAttribute("data-rendered", "true");
  }
  await expect(
    page.locator('.wb-pdf-thumbnail[data-rendered="true"]'),
  ).toHaveCount(3);
  await page.getByRole("button", { name: "第 1 页", exact: true }).click();
  await expect(page.getByLabel("跳到页码")).toHaveValue("1");
  await page.getByLabel("在原文中查找").fill("");
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`reader-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  expect(assetUrls.some((url) => url.endsWith("pdf.worker.min.mjs"))).toBe(
    true,
  );
  expect(outbound).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => (window as unknown as { cspViolations: string[] }).cspViolations,
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() => Reflect.get(globalThis, "__PDF_SCRIPT_EXECUTED")),
  ).toBeUndefined();
  expect(pdfRequests).toBe(1);
  expect(pdfOperations).toEqual(["prepare", "read"]);
  await expectOnlineOnly(page);
});
