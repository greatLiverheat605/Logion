import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("research search", () => {
  let context: BrowserContext, page: Page, resource: string, scope: string;
  let topic: string,
    storageCalls = 0;
  const reads: string[] = [];
  test.beforeAll(async ({ browser, baseURL }) => {
    context = await browser.newContext({
      baseURL,
      locale: "zh-CN",
      viewport: { width: 1440, height: 1000 },
    });
    await context.exposeFunction("recordSearchStorage", () => {
      storageCalls += 1;
    });
    await context.addInitScript(() => {
      for (const name of ["open", "deleteDatabase"] as const) {
        const original = IDBFactory.prototype[name];
        Object.defineProperty(IDBFactory.prototype, name, {
          value: function (...args: unknown[]) {
            void (
              window as unknown as { recordSearchStorage: () => Promise<void> }
            ).recordSearchStorage();
            return Reflect.apply(original, this, args);
          },
        });
      }
    });
    const registration = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL! },
      data: {
        email: `search-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "合成搜索浏览器",
      },
    });
    expect(registration.status()).toBe(201);
    const headers = {
      Origin: baseURL!,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
    const ws = (await (await context.request.get("/api/v1/workspaces")).json())
      .workspaces[0].id;
    const sp = (
      await (
        await context.request.get(`/api/v1/workspaces/${ws}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${ws}/spaces/${sp}`;
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
    const imported = await context.request.post(
      `${scope}/library/resources/pdf-import`,
      {
        headers: {
          ...headers,
          "Content-Type": "application/pdf",
          "X-PDF-Title": "Search needle paper",
        },
        data: await readFile("tests/fixtures/synthetic-reader.pdf"),
      },
    );
    expect(imported.status()).toBe(201);
    resource = (await imported.json()).id;
    topic = randomUUID();
    expect(
      (
        await context.request.post(`${scope}/research/memory/topics`, {
          headers,
          data: {
            id: topic,
            title: "Search needle concept",
            description: "Existing online knowledge",
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await context.request.post(`${scope}/research/memory/quizzes`, {
          headers,
          data: {
            id: randomUUID(),
            topic_id: topic,
            prompt: "Search needle recall question?",
            answer_key: "SEARCH_HIDDEN_ANSWER",
            explanation: "SEARCH_HIDDEN_REASON",
            evaluation_mode: "self_assessed",
          },
        })
      ).status(),
    ).toBe(201);
    page = await context.newPage();
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname.endsWith("/research/search")
      )
        reads.push(request.url());
    });
  });
  test.afterAll(async () => {
    await context?.close();
  });

  test("one initial read and shared command palette query, keyboard navigation to existing review", async () => {
    await page.goto("/search?q=Search%20needle");
    const results = page.getByRole("list", { name: "搜索结果" });
    await expect(results.getByRole("link")).toHaveCount(3);
    expect(reads).toHaveLength(1);
    await expect(results).not.toContainText("SEARCH_HIDDEN");
    const opener = page.getByRole("button", { name: "打开指令面板" });
    await opener.focus();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "指令面板" });
    await dialog
      .getByRole("combobox", { name: "搜索指令" })
      .fill("Search needle");
    await expect(
      dialog.getByRole("option").filter({ hasText: "Search needle paper" }),
    ).toBeVisible();
    expect(reads).toHaveLength(1);
    await dialog.getByRole("option", { name: "打开完整搜索结果" }).click();
    await expect(results.getByRole("link")).toHaveCount(3);
    expect(reads).toHaveLength(1);
    await opener.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await results.getByRole("link").filter({ hasText: "回忆题" }).click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === "/review" && url.searchParams.get("topic") === topic,
    );
    await expect(
      page.getByRole("region", { name: "知识点详情" }),
    ).toContainText("Search needle recall question?");
    await expect(
      page.getByRole("region", { name: "知识点详情" }),
    ).not.toContainText("SEARCH_HIDDEN_ANSWER");
  });

  test("full text search opens the actual matched PDF page and preserves excerpt navigation", async () => {
    const uploaded = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/${resource}/text`) &&
        r.request().method() === "POST",
    );
    await page.goto(`/read/${resource}?page=2`);
    expect((await uploaded).status()).toBe(200);
    await expect(
      page.locator('[data-pdf-page="2"][data-rendered="true"]'),
    ).toBeInViewport();
    await page.goto("/search?q=Experiments");
    const match = page
      .getByRole("list", { name: "搜索结果" })
      .getByRole("link");
    await expect(match).toHaveCount(1);
    await expect(match).toHaveAttribute("href", `/read/${resource}?page=2`);
    await match.click();
    const layer = page.locator(
      '[data-pdf-page="2"] [data-reader-text-layer="true"]',
    );
    await expect(layer).toContainText("Experiments");
    await expect(page.locator('[data-pdf-page="2"]')).toBeInViewport();
    await layer.evaluate((element) => {
      const span = [...element.querySelectorAll("span[data-text-start]")].find(
        (n) => n.textContent?.includes("three synthetic"),
      )!;
      (element.closest(".wb-pane-content") as HTMLElement).focus();
      const range = document.createRange();
      range.selectNodeContents(span);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("h");
    await expect(
      page.getByRole("status").filter({ hasText: "摘录已保存" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "右栏" })
        .getByRole("button", { name: "第 2 页" }),
    ).toBeVisible();
    await page.goto("/search?q=three%20synthetic&kind=excerpt");
    const excerpt = page
      .getByRole("list", { name: "搜索结果" })
      .getByRole("link");
    await expect(excerpt).toHaveCount(1);
    await expect(excerpt).toHaveAttribute("href", `/read/${resource}?page=2`);
  });

  test("superseded palette query cannot replace newer results", async () => {
    await page.getByRole("button", { name: "打开指令面板" }).click();
    let release!: () => void, observed!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      observed = resolve;
    });
    await page.route("**/research/search?**", async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("q") ===
        "obsolete query"
      ) {
        observed();
        await held;
      }
      await route.continue();
    });
    const dialog = page.getByRole("dialog", { name: "指令面板" });
    const input = dialog.getByRole("combobox", { name: "搜索指令" });
    await input.fill("obsolete query");
    await started;
    await input.fill("Search needle");
    await expect(
      dialog.getByRole("option").filter({ hasText: "Search needle paper" }),
    ).toBeVisible();
    release();
    await expect(input).toHaveValue("Search needle");
    await expect(dialog).not.toContainText("没有匹配的内容。");
    await page.keyboard.press("Escape");
    await page.unroute("**/research/search?**");
  });

  test("four widths and both themes, touch targets, accessibility and no offline storage", async ({}, testInfo) => {
    await page.goto("/search?q=Search%20needle");
    await expect(
      page.getByRole("list", { name: "搜索结果" }).getByRole("link"),
    ).toHaveCount(3);
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
        expect(
          (await page
            .getByRole("button", { name: "搜索", exact: true })
            .boundingBox())!.height,
        ).toBeGreaterThanOrEqual(44);
        await page.screenshot({
          path: testInfo.outputPath(`search-${width}-${theme}.png`),
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
  test("switching Space replaces page and palette results with the new scope", async () => {
    const workspace = scope.split("/")[4]!;
    const result = await context.request.post(
      `/api/v1/workspaces/${workspace}/spaces`,
      {
        headers: {
          Origin: new URL(page.url()).origin,
          "X-CSRF-Token": (await context.cookies()).find(
            (c) => c.name === "logion_csrf",
          )!.value,
        },
        data: { name: "空白检索空间", visibility: "private" },
      },
    );
    expect(result.status()).toBe(201);
    const space = (await result.json()).id;
    await page.reload();
    await expect(
      page.getByRole("list", { name: "搜索结果" }).getByRole("link"),
    ).toHaveCount(3);
    await page
      .locator(".wb-sidebar")
      .getByRole("combobox", { name: "空间", exact: true })
      .selectOption(space);
    await expect(
      page.getByRole("status").filter({ hasText: "没有匹配的内容" }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "搜索结果" }).getByRole("link"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "打开指令面板" }).click();
    const dialog = page.getByRole("dialog", { name: "指令面板" });
    await dialog
      .getByRole("combobox", { name: "搜索指令" })
      .fill("Search needle");
    await expect(
      dialog.getByRole("status").filter({ hasText: "没有匹配的内容" }),
    ).toBeVisible();
    await expect(dialog).not.toContainText("Search needle paper");
    expect(
      reads.some((url) => new URL(url).pathname.includes(`/spaces/${space}/`)),
    ).toBe(true);
    await page.keyboard.press("Escape");
    expect(storageCalls).toBe(0);
  });
});
