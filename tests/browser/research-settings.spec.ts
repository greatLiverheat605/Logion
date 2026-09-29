import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

test.describe.serial("online settings", () => {
  let context: BrowserContext,
    page: Page,
    baseURL: string,
    workspace: string,
    ai: string;
  let headers: Record<string, string>;
  const providerName = "合成研究服务商";
  test.beforeAll(async ({ browser, baseURL: origin }) => {
    baseURL = origin!;
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    });
    page = await context.newPage();
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: baseURL },
      data: {
        email: `settings-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic settings",
      },
    });
    expect(registered.status()).toBe(201);
    workspace = (await (await context.request.get("/api/v1/workspaces")).json())
      .workspaces[0].id;
    ai = `/api/v1/workspaces/${workspace}/ai`;
    headers = {
      Origin: baseURL,
      "X-CSRF-Token": (await context.cookies()).find(
        (c) => c.name === "logion_csrf",
      )!.value,
    };
  });
  test.afterAll(async () => {
    await context?.close();
  });
  const section = (name: string) =>
    page.getByRole("region", { name, exact: true });
  const dialog = () => page.getByRole("dialog");
  const save = async () => {
    await dialog()
      .getByRole("button", { name: "保存配置", exact: true })
      .click();
    await expect(dialog()).toHaveCount(0);
  };
  const models = async () =>
    (await (await context.request.get(`${ai}/models`)).json()).models as {
      id: string;
      display_name: string;
      provider_model_id: string;
      version: number;
    }[];
  test("configure a provider, discover models and set research routes without legacy navigation", async () => {
    await page.goto("/settings");
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET")
        requests.push(new URL(request.url()).pathname);
    });
    await page
      .getByRole("link", { name: "AI 服务商与路由", exact: false })
      .click();
    await expect(
      page.getByRole("heading", { name: "AI 服务商与路由", exact: true }),
    ).toBeVisible();
    await expect(section("月度预算")).toContainText("未设置");
    for (const suffix of ["providers", "models", "routes", "budget"])
      expect(requests.filter((p) => p === `${ai}/${suffix}`)).toHaveLength(1);
    expect(
      requests.filter(
        (p) => p === `/api/v1/workspaces/${workspace}/research/ai/presets`,
      ),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "添加服务商", exact: true }).click();
    await dialog().getByLabel("服务商名称", { exact: true }).fill(providerName);
    await dialog()
      .getByLabel("服务地址", { exact: true })
      .fill("https://api.example.com/v1");
    await dialog()
      .getByLabel("API 密钥", { exact: true })
      .fill(`synthetic-${randomUUID()}`);
    await save();
    const providers = section("服务商连接");
    await expect(providers).toContainText("密钥已配置");
    await expect(providers).toContainText("尚未测试");
    await providers.getByRole("button", { name: "测试并发现模型" }).click();
    await dialog().getByRole("button", { name: "确认测试连接" }).click();
    await expect(dialog()).toHaveCount(0);
    await expect(
      section("可用模型").getByRole("button", { name: "编辑模型" }),
    ).toHaveCount(2);
    for (const name of ["synthetic-economical", "synthetic-quality"]) {
      const row = section("可用模型")
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      await row.getByRole("button", { name: "编辑模型" }).click();
      await dialog().getByLabel("支持 JSON 输出", { exact: true }).check();
      await dialog()
        .getByLabel("上下文窗口（tokens，可留空）", { exact: true })
        .fill("32000");
      await save();
    }
    await page.getByRole("button", { name: "配置研究预设" }).click();
    const available = await models();
    await dialog()
      .getByRole("combobox", { name: "经济档 首选", exact: true })
      .selectOption(
        available.find((m) => m.provider_model_id === "synthetic-economical")!
          .id,
      );
    await dialog()
      .getByRole("combobox", { name: "高质量档 首选", exact: true })
      .selectOption(
        available.find((m) => m.provider_model_id === "synthetic-quality")!.id,
      );
    await save();
    await expect(section("任务路由")).toContainText("research:translate");
    const routes = (await (await context.request.get(`${ai}/routes`)).json())
      .routes;
    expect(routes).toHaveLength(7);
    expect(
      routes.find((r: { task_type: string }) => r.task_type === "translate")
        .model_ids,
    ).toEqual([
      available.find((m) => m.provider_model_id === "synthetic-economical")!.id,
    ]);
    await page.getByRole("button", { name: "编辑预算", exact: true }).click();
    await dialog()
      .getByLabel("月度 Token 上限（留空不设上限）", { exact: true })
      .fill("100000");
    await dialog()
      .getByLabel("月度费用上限（最小货币单位，留空不设上限）", { exact: true })
      .fill("2500");
    await save();
    expect(
      await (await context.request.get(`${ai}/budget`)).json(),
    ).toMatchObject({
      monthly_token_budget: 100000,
      monthly_cost_budget_minor: 2500,
      currency: "USD",
    });
    expect(new URL(page.url()).pathname).toBe("/settings/ai");
  });
  test("rotate credentials and preserve a stale edit while rejecting unsafe endpoints", async () => {
    await section("服务商连接")
      .getByRole("button", { name: `${providerName} 更多`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "编辑连接与密钥", exact: true })
      .click();
    const credential = dialog().getByLabel(
      "更新 API 密钥（留空保留已有密钥）",
      { exact: true },
    );
    await expect(credential).toHaveValue("");
    await credential.fill(`synthetic-rotation-${randomUUID()}`);
    await save();
    let provider = (await (await context.request.get(`${ai}/providers`)).json())
      .providers[0];
    expect(provider.credential_configured).toBe(true);
    expect(provider).not.toHaveProperty("credential");
    await section("服务商连接")
      .getByRole("button", { name: `${providerName} 更多`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "编辑连接与密钥", exact: true })
      .click();
    await dialog()
      .getByLabel("服务商名称", { exact: true })
      .fill("保留尚未保存的名称");
    const changed = await context.request.put(
      `${ai}/providers/${provider.id}`,
      {
        headers,
        data: {
          expected_version: provider.version,
          name: provider.name,
          base_url: provider.base_url,
          credential: null,
          enabled: true,
          timeout_seconds: 29,
          max_retries: 0,
        },
      },
    );
    expect(changed.status()).toBe(200);
    await dialog()
      .getByRole("button", { name: "保存配置", exact: true })
      .click();
    await expect(dialog().getByRole("alert")).toContainText("当前输入已保留");
    await expect(
      dialog().getByLabel("服务商名称", { exact: true }),
    ).toHaveValue("保留尚未保存的名称");
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "刷新配置", exact: true }).click();
    await section("服务商连接")
      .getByRole("button", { name: `${providerName} 更多`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "编辑连接与密钥", exact: true })
      .click();
    await expect(
      dialog().getByLabel("连接超时（秒）", { exact: true }),
    ).toHaveValue("29");
    await dialog()
      .getByLabel("服务地址", { exact: true })
      .fill("https://127.0.0.1/v1");
    await dialog()
      .getByRole("button", { name: "保存配置", exact: true })
      .click();
    await expect(dialog().getByRole("alert")).toContainText("公网 HTTPS");
    await expect(dialog().getByLabel("服务地址", { exact: true })).toHaveValue(
      "https://127.0.0.1/v1",
    );
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    provider = (await (await context.request.get(`${ai}/providers`)).json())
      .providers[0];
    expect(provider.base_url).toBe("https://api.example.com/v1");
  });
  test("add a manual model and an ordered fallback route, then explicitly remove that route", async () => {
    await page
      .getByRole("button", { name: "手动添加模型", exact: true })
      .click();
    const provider = (
      await (await context.request.get(`${ai}/providers`)).json()
    ).providers[0];
    await dialog()
      .getByRole("combobox", { name: "所属服务商", exact: true })
      .selectOption(provider.id);
    await dialog()
      .getByLabel("模型标识", { exact: true })
      .fill("synthetic-manual");
    await dialog().getByLabel("模型显示名称", { exact: true }).fill("手动模型");
    await save();
    await page.getByRole("button", { name: "添加路由", exact: true }).click();
    await dialog().getByLabel("路由名称", { exact: true }).fill("合成备用任务");
    await dialog()
      .getByLabel("任务类型", { exact: true })
      .fill("synthetic.task");
    const available = await models(),
      primary = available.find(
        (m) => m.provider_model_id === "synthetic-quality",
      )!,
      fallback = available.find(
        (m) => m.provider_model_id === "synthetic-economical",
      )!;
    await dialog()
      .getByRole("combobox", { name: "路由模型 首选", exact: true })
      .selectOption(primary.id);
    await dialog()
      .getByRole("button", { name: "添加路由模型备选", exact: true })
      .click();
    await dialog()
      .getByRole("combobox", { name: "路由模型 备选 1", exact: true })
      .selectOption(fallback.id);
    await save();
    const routes = (await (await context.request.get(`${ai}/routes`)).json())
      .routes;
    expect(
      routes.find(
        (r: { task_type: string }) => r.task_type === "synthetic.task",
      ).model_ids,
    ).toEqual([primary.id, fallback.id]);
    await page
      .getByRole("button", { name: "合成备用任务 更多", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除路由", exact: true }).click();
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    await expect(section("任务路由")).toContainText("合成备用任务");
    await page
      .getByRole("button", { name: "合成备用任务 更多", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "删除路由", exact: true }).click();
    await dialog()
      .getByRole("button", { name: "确认删除配置", exact: true })
      .click();
    await expect(dialog()).toHaveCount(0);
    await expect(
      section("任务路由").getByRole("heading", {
        name: "合成备用任务",
        exact: true,
      }),
    ).toHaveCount(0);
  });
  test("audit filters use real server events and scope changes do not duplicate the first request", async () => {
    await page.getByRole("link", { name: "返回设置", exact: true }).click();
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET") requests.push(new URL(r.url()).pathname);
    });
    await page.getByRole("link", { name: "审计记录", exact: false }).click();
    await expect(section("审计事件")).toContainText("identity.registered");
    expect(requests.filter((p) => p === "/api/v1/audit/me")).toHaveLength(1);
    await page
      .getByRole("combobox", { name: "审计范围", exact: true })
      .selectOption("workspace");
    await expect(section("审计事件")).toContainText("ai.route_deleted");
    expect(
      requests.filter(
        (p) => p === `/api/v1/workspaces/${workspace}/audit-events`,
      ),
    ).toHaveLength(1);
    await page
      .getByLabel("操作代码（可留空）", { exact: true })
      .fill("ai.provider_updated");
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await expect(section("审计事件").getByRole("listitem")).toHaveCount(2);
    await expect(section("审计事件")).not.toContainText("ai.route_deleted");
  });
  for (const [path, title, prefix] of [
    ["/settings/ai", "AI 服务商与路由", "ai-settings"],
    ["/settings/audit", "审计记录", "audit-settings"],
  ]) {
    test(`${prefix} supports four widths, both themes and online-only storage`, async ({}, testInfo) => {
      await page.goto(path!);
      await expect(
        page.getByRole("heading", { name: title!, exact: true }),
      ).toBeVisible();
      if (prefix === "ai-settings")
        await expect(section("服务商连接")).toContainText(providerName);
      else {
        await page
          .getByRole("combobox", { name: "审计范围", exact: true })
          .selectOption("workspace");
        await expect(section("审计事件")).toContainText("ai.route_deleted");
      }
      for (const width of [320, 390, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width <= 390) {
          const control = page.getByRole("button", {
            name: prefix === "ai-settings" ? "添加服务商" : "应用筛选",
            exact: true,
          });
          expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(
            44,
          );
        }
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await expect(page.locator("html")).toHaveAttribute(
            "data-theme",
            theme,
          );
          expect((await new AxeBuilder({ page }).analyze()).violations).toEqual(
            [],
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: testInfo.outputPath(`${prefix}-${width}-${theme}.png`),
            fullPage: true,
          });
        }
      }
      expect(
        await page.evaluate(async () => await indexedDB.databases()),
      ).toEqual([]);
      expect(
        await page.evaluate(
          async () => (await navigator.serviceWorker.getRegistrations()).length,
        ),
      ).toBe(0);
    });
  }
  test("disabling a service blocks discovery and deleting it requires explicit confirmation", async () => {
    await page.goto("/settings/ai");
    await section("服务商连接")
      .getByRole("button", { name: `${providerName} 更多`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "编辑连接与密钥", exact: true })
      .click();
    await dialog().getByLabel("启用服务商", { exact: true }).uncheck();
    await save();
    await expect(
      section("服务商连接").getByRole("button", { name: "测试并发现模型" }),
    ).toBeDisabled();
    await section("服务商连接")
      .getByRole("button", { name: `${providerName} 更多`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "删除服务商", exact: true })
      .click();
    await dialog().getByRole("button", { name: "取消", exact: true }).click();
    expect(
      (await (await context.request.get(`${ai}/providers`)).json()).providers,
    ).toHaveLength(1);
    await section("服务商连接")
      .getByRole("button", { name: `${providerName} 更多`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "删除服务商", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "确认删除配置", exact: true })
      .click();
    await expect(dialog()).toHaveCount(0);
    await expect(section("服务商连接")).toContainText("还没有服务商");
    expect(
      (await (await context.request.get(`${ai}/providers`)).json()).providers,
    ).toEqual([]);
  });
});
