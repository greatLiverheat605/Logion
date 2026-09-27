import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "搜索指令" }).fill(label);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "指令面板" })).toHaveCount(0);
}
async function geometry(page: Page) {
  const problems = await page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > innerWidth)
      issues.push("document overflow");
    for (const element of document.querySelectorAll<HTMLElement>(
      ".wb-titlebar, .wb-page, .wb-pane-header, .wb-pane-content, .wb-reader-tools",
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
      if (header.getBoundingClientRect().height !== 32)
        issues.push("header height");
      const body = header.nextElementSibling!;
      if (
        header.getBoundingClientRect().bottom >
        body.getBoundingClientRect().top + 1
      )
        issues.push("header overlaps content");
    }
    return issues;
  });
  expect(problems).toEqual([]);
}
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
      await page.setViewportSize({ width, height: 960 });
      await page.goto("/today");
      await expect(
        page.getByRole("heading", { name: "今天", exact: true }).first(),
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
      await page.goto("/read/example");
      await expect(
        page.getByRole("region", { name: "三栏阅读布局" }),
      ).toBeVisible();
      await geometry(page);
      await page.screenshot({
        path: testInfo.outputPath(`panes-${width}-${theme}.png`),
      });
      const audit = await new AxeBuilder({ page })
        .include(".wb-root")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(audit.violations).toEqual([]);
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
