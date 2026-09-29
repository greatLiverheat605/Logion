import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("recoverable Space archive", () => {
  let context: BrowserContext,
    page: Page,
    workspaceId: string,
    spaceId: string,
    noteId: string;
  let headers: Record<string, string>;
  const url = () =>
    `/api/v1/workspaces/${workspaceId}/research/spaces/${spaceId}/archive`;
  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    });
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL! },
      data: {
        email: `spaces-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "合成空间管理浏览器",
      },
    });
    expect(registered.status()).toBe(201);
    headers = {
      Origin: baseURL!,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
    workspaceId = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    spaceId = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspaceId}/spaces`)
      ).json()
    ).spaces[0].id;
    const created = await context.request.post(
      `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/research/notes`,
      { headers, data: { id: randomUUID(), title: "归档保留的笔记" } },
    );
    expect(created.status()).toBe(201);
    noteId = (await created.json()).id;
    await context.addInitScript(() => {
      IDBFactory.prototype.open = () => {
        throw new Error("Space management must remain online only");
      };
    });
    page = await context.newPage();
    await page.goto("/settings/spaces");
    await expect(
      page.getByRole("button", { name: "归档空间：私人空间", exact: true }),
    ).toBeVisible();
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("four widths and themes, keyboard cancel, accessible controls and no offline storage", async ({}, info) => {
    for (const width of [320, 390, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
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
        for (const control of await page
          .locator(".wb-space-settings button, .wb-space-settings select")
          .all()) {
          const box = (await control.boundingBox())!;
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.width).toBeGreaterThanOrEqual(44);
        }
        await page.screenshot({
          path: info.outputPath(`spaces-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    const archive = page.getByRole("button", {
      name: "归档空间：私人空间",
      exact: true,
    });
    await archive.focus();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(archive).toBeFocused();
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });

  test("archive the final active Space and restore it without losing its note", async () => {
    await page
      .getByRole("button", { name: "归档空间：私人空间", exact: true })
      .click();
    await page.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "空间已归档" }),
    ).toBeVisible();
    expect(
      (
        await (
          await context.request.get(`/api/v1/workspaces/${workspaceId}/spaces`)
        ).json()
      ).spaces,
    ).toEqual([]);
    const notePath = `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}/research/notes/${noteId}`;
    expect((await context.request.get(notePath)).status()).toBe(404);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "空间管理", exact: true }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "已归档", exact: true }).click();
    await page
      .getByRole("button", { name: "恢复空间：私人空间", exact: true })
      .click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "空间已恢复" }),
    ).toBeVisible();
    const note = await context.request.get(notePath);
    expect(note.status()).toBe(200);
    expect((await note.json()).title).toBe("归档保留的笔记");
    await page.getByRole("radio", { name: "使用中", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "归档空间：私人空间", exact: true }),
    ).toBeVisible();
  });

  test("stale confirmation stays visible until an explicit refresh", async () => {
    await page
      .getByRole("button", { name: "归档空间：私人空间", exact: true })
      .click();
    expect(
      (
        await context.request.patch(url(), {
          headers,
          data: { expected_version: 3, status: "archived" },
        })
      ).status(),
    ).toBe(200);
    await page.getByRole("button", { name: "确认归档", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "空间已在其他页面更新",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "取消", exact: true })
      .click();
    await page.getByRole("radio", { name: "已归档", exact: true }).click();
    await page.getByRole("button", { name: "刷新空间", exact: true }).click();
    await page
      .getByRole("button", { name: "恢复空间：私人空间", exact: true })
      .click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "空间已恢复" }),
    ).toBeVisible();
  });
});
