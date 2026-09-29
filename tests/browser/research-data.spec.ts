import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { downloadResearchExport } from "./helpers/research-export";

test.describe.serial("online data export", () => {
  let context: BrowserContext, page: Page, workspace: string;
  let storageCalls = 0;
  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    });
    await context.exposeFunction("recordLegacyStorage", () => {
      storageCalls += 1;
    });
    await context.addInitScript(() => {
      for (const name of ["open", "deleteDatabase"] as const) {
        const original = IDBFactory.prototype[name];
        Object.defineProperty(IDBFactory.prototype, name, {
          value: function (...args: unknown[]) {
            void (
              window as unknown as { recordLegacyStorage: () => Promise<void> }
            ).recordLegacyStorage();
            return Reflect.apply(original, this, args);
          },
        });
      }
    });
    page = await context.newPage();
    const response = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL! },
      data: {
        email: `data-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "合成导出浏览器",
      },
    });
    expect(response.status()).toBe(201);
    const headers = {
      Origin: baseURL!,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
    workspace = (await (await context.request.get("/api/v1/workspaces")).json())
      .workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    const scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
    expect(
      (
        await context.request.post(`${scope}/library/resources`, {
          headers,
          data: {
            title: "合成导出论文",
            resource_type: "paper",
            doi: "10.1234/export-browser",
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await context.request.post(`${scope}/research/ideas`, {
          headers,
          data: { title: "合成私人想法", body: "EXPORT_ONLY_PRIVATE_IDEA" },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await context.request.post(`${scope}/notes`, {
          headers,
          data: {
            id: randomUUID(),
            task_id: null,
            title: "已有普通笔记",
            markdown_body: "保留旧笔记正文",
          },
        })
      ).status(),
    ).toBe(201);
  });
  test.afterAll(async () => {
    await context?.close();
  });
  test("confirms private scope, exports through the worker and verifies the downloaded ZIP", async () => {
    await page.goto("/settings");
    const reads: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET")
        reads.push(new URL(request.url()).pathname);
    });
    await page.getByRole("link", { name: "数据导出", exact: false }).click();
    await expect(
      page.getByText("还没有导出记录。", { exact: true }),
    ).toBeVisible();
    expect(
      reads.filter(
        (path) =>
          path === `/api/v1/workspaces/${workspace}/research/data-exports`,
      ),
    ).toHaveLength(1);
    const create = page.getByRole("button", { name: "创建导出", exact: true });
    await create.focus();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "返回", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(create).toBeFocused();
    const data = await downloadResearchExport(page);
    expect(data.objects.resources![0]).toMatchObject({
      title: "合成导出论文",
      doi: "10.1234/export-browser",
    });
    expect(data.objects.research_ideas![0]!.body).toBe(
      "EXPORT_ONLY_PRIVATE_IDEA",
    );
    expect(data.objects.notes![0]!.markdown_body).toBe("保留旧笔记正文");
  });
  test("data settings works at four widths in both themes with no offline storage", async ({}, testInfo) => {
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      if (width <= 390)
        expect(
          (await page
            .getByRole("button", { name: "创建导出", exact: true })
            .boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
          [],
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`data-settings-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    expect(storageCalls).toBe(0);
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });
  test("retains the old export format in the same settings page", async () => {
    await page
      .getByRole("combobox", { name: "导出格式", exact: true })
      .selectOption("legacy");
    await expect(
      page.getByText("还没有导出记录。", { exact: true }),
    ).toBeVisible();
    const data = await downloadResearchExport(page, "logion-export-v1");
    expect(data.objects.resources).toEqual([]);
    expect(data.objects.notes![0]!.markdown_body).toBe("保留旧笔记正文");
    expect(data.objects).not.toHaveProperty("research_ideas");
    await page
      .getByRole("combobox", { name: "导出格式", exact: true })
      .selectOption("research");
    await expect(
      page.getByRole("region", { name: "导出任务" }).getByRole("listitem"),
    ).toHaveCount(1);
  });
});
