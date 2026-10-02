import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { components } from "@logion/contracts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const spaceIds = [
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
type Settings = Map<string, { key: string; value: string; version: number }>;

async function installApi(
  context: BrowserContext,
  settings: Settings = new Map(),
) {
  await context.addCookies([
    { name: "logion_csrf", value: randomUUID(), url: "http://127.0.0.1:3080" },
  ]);
  await context.route("**/api/v1/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    if (path === "/api/v1/auth/session")
      return route.fulfill({
        json: {
          user: {
            id: "00000000-0000-4000-8000-000000000004",
            email: "research@example.com",
            status: "active",
            created_at: "2026-01-01T00:00:00Z",
            email_verified_at: "2026-01-01T00:00:00Z",
          },
          session_expires_at: new Date(Date.now() + 900_000).toISOString(),
        },
      });
    if (path === "/api/v1/workspaces")
      return route.fulfill({
        json: { workspaces: [{ id: workspaceId, name: "个人研究" }] },
      });
    if (path === `/api/v1/workspaces/${workspaceId}/spaces`)
      return route.fulfill({
        json: {
          spaces: spaceIds.map((id, i) => ({
            id,
            name: ["机器学习", "方法与写作"][i],
          })),
        },
      });
    if (path === `/api/v1/workspaces/${workspaceId}/notifications`)
      return route.fulfill({ json: { notifications: [] } });
    if (path === "/api/v1/users/me/settings") {
      if (request.method() === "PUT") {
        expect(request.headers()["x-csrf-token"]).toBeTruthy();
        const updates = request.postDataJSON().settings as {
          key: string;
          value: string;
          version: number;
        }[];
        if (
          updates.some(
            (item) => (settings.get(item.key)?.version ?? 0) !== item.version,
          )
        )
          return route.fulfill({
            status: 409,
            json: {
              code: "USER_SETTING_VERSION_CONFLICT",
              message: "Conflict",
              retryable: false,
              request_id: "synthetic",
              details: {},
            },
          });
        for (const update of updates)
          settings.set(update.key, { ...update, version: update.version + 1 });
        return route.fulfill({
          json: { settings: updates.map((item) => settings.get(item.key)) },
        });
      }
      return route.fulfill({ json: { settings: [...settings.values()] } });
    }
    return route.fulfill({
      status: 404,
      json: {
        code: "NOT_FOUND",
        message: "Not found",
        request_id: "synthetic",
        retryable: false,
      },
    });
  });
  return settings;
}
async function command(page: Page, label: string) {
  // The mock server can save before React clears the in-flight write guard.
  await expect(page.getByLabel("空间", { exact: true })).toBeEnabled();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "搜索指令" }).fill(label);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "指令面板" })).toHaveCount(0);
  await expect(page.getByLabel("空间", { exact: true })).toBeEnabled();
}
async function geometry(page: Page) {
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth)
      issues.push("document overflow");
    for (const element of document.querySelectorAll<HTMLElement>(
      ".wb-titlebar, .wb-page, .wb-pane-header, .wb-pane-content, .wb-reader-tools, .wb-reader-hint, .wb-mobile-panes, .wb-inspector, .wb-library-row, .wb-library-form",
    )) {
      if (
        element.getBoundingClientRect().width &&
        element.scrollWidth > element.clientWidth + 1
      )
        issues.push(element.className);
    }
    for (const header of document.querySelectorAll<HTMLElement>(
      ".wb-pane-header",
    )) {
      if (!header.getBoundingClientRect().width) continue;
      if (
        header.getBoundingClientRect().height !== (innerWidth < 768 ? 52 : 32)
      )
        issues.push("header height");
      if (innerWidth < 768) {
        for (const button of header.querySelectorAll("button")) {
          const box = button.getBoundingClientRect();
          if (box.width < 44 || box.height < 44)
            issues.push("header touch target");
        }
      }
      const body = header.nextElementSibling!;
      if (
        header.getBoundingClientRect().bottom >
        body.getBoundingClientRect().top + 1
      )
        issues.push("header overlaps content");
    }
    const hint = document.querySelector(".wb-reader-hint");
    const panes = document.querySelector(".wb-panes");
    if (
      hint &&
      panes &&
      hint.getBoundingClientRect().bottom >
        panes.getBoundingClientRect().top + 1
    )
      issues.push("hint overlaps panes");
    return issues;
  });
  expect(problems).toEqual([]);
}

async function installLibrary(context: BrowserContext) {
  type Resource = components["schemas"]["LibraryResource"];
  const records = new Map<string, Resource>();
  const initial: Resource = {
    id: "00000000-0000-4000-8000-000000000010",
    workspace_id: workspaceId,
    space_id: spaceIds[0]!,
    title: "注意力与知识表达：一份合成研究文献",
    resource_type: "paper",
    reading_status: "reading",
    tags: ["方法", "待读"],
    doi: "10.1234/synthetic",
    csl: {
      author: [{ literal: "Example Researcher" }],
      issued: { "date-parts": [[2024]] },
      "container-title": "Synthetic Research",
      abstract:
        "本文是一份用于界面验证的合成文献，介绍如何建立可追溯的证据与阅读记录。",
    },
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  records.set(initial.id, initial);
  const state = { conflict: false, writes: 0 };
  await context.route("**/api/v1/**/library/resources**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const id = url.pathname.split("/resources/")[1];
    if (url.pathname.endsWith("/pdf/prepare")) {
      expect(request.method()).toBe("POST");
      expect(request.headers()["x-csrf-token"]).toBeTruthy();
      return route.fulfill({
        status: 409,
        json: {
          code: "PDF_LOCATOR_INVALID",
          message: "The synthetic metadata-only source has no PDF.",
          request_id: "synthetic",
          retryable: false,
        },
      });
    }
    if (request.method() === "GET") {
      if (id)
        return route.fulfill({
          status: records.has(id) ? 200 : 404,
          json: records.get(id) ?? {
            code: "NOT_FOUND",
            message: "Missing",
            retryable: false,
            request_id: "synthetic",
          },
        });
      return route.fulfill({
        json: {
          resources: [...records.values()].filter(
            (item) =>
              (!url.searchParams.get("status") ||
                item.reading_status === url.searchParams.get("status")) &&
              (!url.searchParams.get("tag") ||
                item.tags?.includes(url.searchParams.get("tag")!)),
          ),
          next_cursor: null,
        },
      });
    }
    state.writes++;
    expect(request.headers()["x-csrf-token"]).toBeTruthy();
    const body = request.postDataJSON();
    const duplicate = [...records.values()].find(
      (item) => item.id !== id && body.doi && item.doi === body.doi,
    );
    if (duplicate || state.conflict)
      return route.fulfill({
        status: 409,
        json: {
          code: duplicate ? "LIBRARY_DUPLICATE" : "RESOURCE_VERSION_CONFLICT",
          message: "Conflict",
          details: duplicate ? { existing_id: duplicate.id } : {},
          retryable: false,
          request_id: "synthetic",
        },
      });
    if (request.method() === "DELETE") {
      expect(body.expected_version).toBe(records.get(id!)?.version);
      records.delete(id!);
      return route.fulfill({ status: 204 });
    }
    if (id) expect(body.expected_version).toBe(records.get(id)?.version);
    const resource = {
      ...initial,
      ...body,
      id: id ?? randomUUID(),
      version: id ? records.get(id)!.version + 1 : 1,
    };
    records.set(resource.id, resource);
    return route.fulfill({ status: id ? 200 : 201, json: resource });
  });
  return { records, initial, state };
}

for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1024, 1440]) {
    test(`library list, inspector and editor fit ${width} / ${theme}`, async ({
      page,
      context,
    }, testInfo) => {
      await installApi(
        context,
        new Map([
          [
            "appearance.theme",
            {
              key: "appearance.theme",
              value: JSON.stringify(theme),
              version: 1,
            },
          ],
        ]),
      );
      const { initial } = await installLibrary(context);
      await page.setViewportSize({ width, height: 960 });
      await page.goto("/library");
      await page
        .getByRole("button", { name: new RegExp(initial.title) })
        .click();
      const inspector = page.getByRole("complementary", { name: "文献信息" });
      await expect(
        inspector.getByRole("heading", { name: initial.title }),
      ).toBeVisible();
      await geometry(page);
      await page.screenshot({
        path: testInfo.outputPath(`library-${width}-${theme}.png`),
        fullPage: true,
      });
      expect(
        (
          await new AxeBuilder({ page })
            .include(".wb-root")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.getByRole("button", { name: "编辑文献" }).click();
      await expect(
        page.getByRole("dialog", { name: "编辑文献" }),
      ).toBeVisible();
      await geometry(page);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "进入阅读" }).click();
      if (width < 768)
        await page.getByRole("radio", { name: "左 · 大纲" }).click();
      await page.getByRole("button", { name: "选择左栏内容" }).click();
      await page
        .getByRole("menuitem", { name: "文献信息", exact: true })
        .click();
      await expect(
        page
          .getByRole("region", { name: "左栏", exact: true })
          .getByRole("heading", { name: initial.title }),
      ).toBeVisible();
      await geometry(page);
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
      expect(
        await page.evaluate(() =>
          navigator.serviceWorker
            .getRegistrations()
            .then((rows) => rows.length),
        ),
      ).toBe(0);
    });
  }
}

test("library CRUD keeps failed inputs, filters records and opens owner-only duplicates", async ({
  page,
  context,
}) => {
  await installApi(context);
  const { records, initial, state } = await installLibrary(context);
  await page.goto("/library");
  await page.getByRole("button", { name: "新建文献" }).click();
  let dialog = page.getByRole("dialog", { name: "新建文献" });
  await dialog.getByLabel("标题", { exact: true }).fill("手动录入的合成文献");
  await dialog.getByLabel("DOI", { exact: true }).fill(initial.doi!);
  await dialog.getByRole("button", { name: "保存文献" }).click();
  await expect(dialog.getByRole("alert")).toContainText("已有条目");
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
    "手动录入的合成文献",
  );
  await dialog.getByRole("button", { name: "查看已有文献" }).click();
  await expect(
    page.getByRole("complementary", { name: "文献信息" }),
  ).toContainText(initial.title);
  await page.getByRole("button", { name: "新建文献" }).click();
  dialog = page.getByRole("dialog", { name: "新建文献" });
  await dialog.getByLabel("标题", { exact: true }).fill("手动录入的合成文献");
  await dialog.getByLabel("作者（每行一位）").fill("Synthetic Author");
  await dialog.getByLabel("标签（逗号分隔）").fill("new");
  const before = state.writes;
  await context.setOffline(true);
  await dialog.getByRole("button", { name: "保存文献" }).click();
  await expect(dialog.getByRole("alert")).toContainText("需要联网");
  expect(state.writes).toBe(before);
  await context.setOffline(false);
  await dialog.getByRole("button", { name: "保存文献" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /手动录入的合成文献/ }),
  ).toBeVisible();
  await page.getByLabel("筛选标签").fill("new");
  await expect(
    page.getByRole("button", { name: new RegExp(initial.title) }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "编辑文献" }).click();
  dialog = page.getByRole("dialog", { name: "编辑文献" });
  state.conflict = true;
  await dialog.getByLabel("标题", { exact: true }).fill("保留的编辑内容");
  await dialog.getByRole("button", { name: "保存文献" }).click();
  await expect(dialog.getByRole("alert")).toContainText("当前输入已保留");
  await expect(dialog.getByLabel("标题", { exact: true })).toHaveValue(
    "保留的编辑内容",
  );
  state.conflict = false;
  await dialog.getByLabel("阅读状态").selectOption("close_read");
  await dialog.getByRole("button", { name: "保存文献" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /保留的编辑内容/ }),
  ).toContainText("精读完成");
  await page.getByRole("button", { name: "删除文献", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByText("这里还没有文献")).toBeVisible();
  expect(records.size).toBe(1);
});
test("feature off returns 404 for every workbench route and retains legacy access", async ({
  request,
}) => {
  for (const path of [
    "/today",
    "/library",
    "/read/example",
    "/questions",
    "/graph",
    "/review",
    "/plan",
    "/settings",
    "/legacy-data-check",
    "/settings/legacy-data",
    "/settings/spaces",
    "/settings/notifications",
  ]) {
    const response = await request.get(`http://127.0.0.1:3081${path}`);
    expect(response.status()).toBe(404);
    expect(response.headers()["content-security-policy"]).toContain(
      "default-src 'self'",
    );
  }
  expect((await request.get("http://127.0.0.1:3081/app/today")).status()).toBe(
    200,
  );
});
for (const theme of ["light", "dark"] as const) {
  for (const width of [320, 390, 1024, 1440]) {
    test(`shell, command palette and panes fit ${width} / ${theme}`, async ({
      page,
      context,
    }, testInfo) => {
      const settings = new Map([
        [
          "appearance.theme",
          { key: "appearance.theme", value: JSON.stringify(theme), version: 1 },
        ],
      ]);
      await installApi(context, settings);
      const { initial } = await installLibrary(context);
      await page.setViewportSize({ width, height: 960 });
      await page.goto("/today");
      await expect(
        page.getByRole("heading", { name: "今日", exact: true }).first(),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await geometry(page);
      const shellAudit = await new AxeBuilder({ page })
        .include(".wb-root")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(shellAudit.violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`shell-${width}-${theme}.png`),
      });
      await page.keyboard.press("Control+k");
      await expect(
        page.getByRole("dialog", { name: "指令面板" }),
      ).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`commands-${width}-${theme}.png`),
      });
      await page.keyboard.press("Escape");
      await page.goto(`/read/${initial.id}`);
      await expect(
        page.getByRole("region", { name: "三栏阅读布局" }),
      ).toBeVisible();
      if (width >= 768) {
        const left = page.getByRole("region", { name: "左栏", exact: true });
        await expect(left.locator(".wb-pane-header")).toContainText("大纲");
        await page.getByRole("button", { name: "选择左栏内容" }).click();
        await page
          .getByRole("menuitem", { name: "文献信息", exact: true })
          .click();
        await expect(
          page
            .getByRole("region", { name: "左栏", exact: true })
            .getByRole("heading", { name: initial.title }),
        ).toBeVisible();
        await page.getByRole("button", { name: "选择左栏内容" }).click();
        await page.getByRole("menuitem", { name: "大纲", exact: true }).click();
        await expect(
          page.getByRole("button", { name: "打开指令面板" }),
        ).toContainText(
          (await page.evaluate(() => navigator.platform)).startsWith("Mac")
            ? "⌘+K"
            : "Ctrl+K",
        );
      }
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "显示栏目" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("complementary", { name: "阅读工具提示" }),
      ).toBeVisible();
      if (width < 768)
        await expect(
          page.getByRole("radiogroup", { name: "当前栏目" }),
        ).toBeVisible();
      await geometry(page);
      await page.screenshot({
        path: testInfo.outputPath(`reader-default-${width}-${theme}.png`),
      });
      const audit = await new AxeBuilder({ page })
        .include(".wb-root")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
      await page.keyboard.press("Control+Backslash");
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "显示栏目" }),
      ).toBeVisible();
      await geometry(page);
      await page.screenshot({
        path: testInfo.outputPath(`reader-tools-${width}-${theme}.png`),
      });
      await page.keyboard.press("Control+Backslash");
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toHaveCount(0);
      await command(page, "显示全部工具栏");
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toBeVisible();
      await command(page, "隐藏全部工具栏");
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toHaveCount(0);
      await command(page, "显示全部工具栏");
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toBeVisible();
      await page.keyboard.press("Control+k");
      await expect(
        page.getByRole("dialog", { name: "指令面板" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "指令面板" })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("radiogroup", { name: "预设布局" }),
      ).toHaveCount(0);
      expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
      expect(
        await page.evaluate(() =>
          navigator.serviceWorker
            .getRegistrations()
            .then((items) => items.length),
        ),
      ).toBe(0);
    });
  }
}
test("keyboard commands, persistent context and layouts survive a fresh browser context", async ({
  page,
  context,
  browser,
}) => {
  const settings = await installApi(context);
  await page.goto("/today");
  await expect(page.getByLabel("空间", { exact: true })).toHaveValue(
    spaceIds[0],
  );
  await page.getByLabel("空间", { exact: true }).selectOption(spaceIds[1]);
  await expect.poll(() => settings.get("workbench.context")?.version).toBe(1);
  await command(page, "夜间外观");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await command(page, "前往文献库");
  await expect(page).toHaveURL(/\/library$/);
  await page.goto("/read/example");
  await expect(
    page.getByRole("region", { name: "三栏阅读布局" }),
  ).toBeVisible();
  await page.keyboard.press("Alt+Shift+4");
  await expect(
    page.getByRole("region", { name: "中栏", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "左栏", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Alt+2");
  await expect(
    page.getByRole("region", { name: "中栏", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => JSON.parse(settings.get("workbench.layouts")!.value).preset)
    .toBe("focus");
  await command(page, "精读布局");
  await expect
    .poll(() => JSON.parse(settings.get("workbench.layouts")!.value).preset)
    .toBe("reading");
  await expect(page.getByRole("radiogroup", { name: "预设布局" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Alt+Shift+4");
  await expect
    .poll(() => JSON.parse(settings.get("workbench.layouts")!.value).preset)
    .toBe("focus");
  await page.getByRole("button", { name: "知道了" }).click();
  await expect(
    page.getByRole("complementary", { name: "阅读工具提示" }),
  ).toHaveCount(0);
  expect(settings.get("reader.hint_dismissed")?.value).toBe("true");
  const fresh = await browser.newContext();
  try {
    await installApi(fresh, settings);
    const other = await fresh.newPage();
    await other.goto("http://127.0.0.1:3080/read/example");
    await expect(other.getByLabel("空间", { exact: true })).toHaveValue(
      spaceIds[1],
    );
    await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      other.getByRole("complementary", { name: "阅读工具提示" }),
    ).toHaveCount(0);
    await expect(
      other.getByRole("region", { name: "左栏", exact: true }),
    ).toHaveCount(0);
    await other.keyboard.press("Alt+Shift+1");
    await expect(other.getByRole("separator").first()).toBeVisible();
    await expect
      .poll(() => JSON.parse(settings.get("workbench.layouts")!.value).preset)
      .toBe("reading");
    const separator = other.getByRole("separator").first();
    await separator.focus();
    await other.keyboard.press("ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", "24");
    await expect
      .poll(
        () =>
          JSON.parse(settings.get("workbench.layouts")!.value).panes[0].width,
      )
      .toBe(24);
    const box = (await separator.boundingBox())!;
    await other.mouse.move(box.x + 2, box.y + 50);
    await other.mouse.down();
    await other.mouse.move(box.x + 42, box.y + 50);
    await other.mouse.up();
    await expect
      .poll(
        () =>
          JSON.parse(settings.get("workbench.layouts")!.value).panes[0].width,
      )
      .toBeGreaterThan(24);
  } finally {
    await fresh.close();
  }
});
test("offline feedback refuses changes, and conflicting preferences are not overwritten", async ({
  page,
  context,
}) => {
  const settings = await installApi(context);
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  settings.set("appearance.theme", {
    key: "appearance.theme",
    value: '"dark"',
    version: 1,
  });
  await page.getByRole("radio", { name: "日间", exact: true }).click();
  await expect(page.locator(".wb-notice[role=alert]")).toContainText(
    "其他页面更新",
  );
  expect(settings.get("appearance.theme")?.value).toBe('"dark"');
  await context.setOffline(true);
  await expect(page.locator(".wb-notice[role=alert]")).toContainText(
    "需要联网",
  );
  await page.getByRole("radio", { name: "日间", exact: true }).click();
  await context.setOffline(false);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(settings.get("appearance.theme")?.value).toBe('"dark"');
});
