import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Resolve the SDK from the bridge workspace; the Web app has no MCP dependency.
const bridgeRequire = createRequire(
  resolve("packages/mcp-bridge/package.json"),
);
const { Client } = bridgeRequire("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = bridgeRequire(
  "@modelcontextprotocol/sdk/client/stdio.js",
);

test.describe.serial("personal agent inbox", () => {
  let context: BrowserContext, page: Page, origin: string, scope: string;
  let token: string, tokenId: string, bridge: InstanceType<typeof Client>;
  const agentName = "本机研究助手";
  const sourceTitle = "本人审阅后的合成论文";
  const card = (kind: string) =>
    page.getByRole("article", { name: kind + "投稿", exact: true });
  test.beforeAll(async ({ browser, baseURL }) => {
    origin = baseURL!;
    context = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
    });
    page = await context.newPage();
    const registered = await context.request.post("/api/v1/auth/register", {
      headers: { Origin: origin },
      data: {
        email: `agent-${randomUUID()}@example.com`,
        password: `${randomBytes(24).toString("base64url")}Aa1!`,
        device_name: "Synthetic agent acceptance",
      },
    });
    expect(registered.status()).toBe(201);
    const workspace = (
      await (await context.request.get("/api/v1/workspaces")).json()
    ).workspaces[0].id;
    const space = (
      await (
        await context.request.get(`/api/v1/workspaces/${workspace}/spaces`)
      ).json()
    ).spaces[0].id;
    scope = `/api/v1/workspaces/${workspace}/spaces/${space}`;
  });
  test.afterAll(async () => {
    await bridge?.close();
    await context?.close();
  });
  async function submit(payload: object) {
    const result = await bridge.callTool({
      name: "submit_inbox",
      arguments: { submission_key: randomUUID(), payload },
    });
    expect(result.isError).not.toBe(true);
    return JSON.parse(result.content[0].text);
  }

  test("issue once with keyboard and submit through the real stdio bridge", async () => {
    await page.goto("/settings/agents");
    await expect(
      page.getByRole("heading", { name: "Agent 与收件箱", exact: true }),
    ).toBeVisible();
    await page.getByLabel("令牌名称", { exact: true }).fill(agentName);
    await page.getByRole("button", { name: "创建令牌", exact: true }).focus();
    await page.keyboard.press("Enter");
    const input = page.getByLabel("新令牌值", { exact: true });
    await expect(input).toBeVisible();
    token = await input.inputValue();
    expect(token.startsWith("logion_pat_")).toBe(true);
    await page
      .getByRole("button", { name: "已保存，关闭显示", exact: true })
      .click();
    await expect(input).toHaveCount(0);
    const list = await context.request.get("/api/v1/research/agent-tokens");
    const body = await list.text();
    expect(body.includes(token)).toBe(false);
    tokenId = JSON.parse(body).tokens[0].id;
    bridge = new Client({ name: "synthetic-owner-acceptance", version: "1.0" });
    await bridge.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("packages/mcp-bridge/server.mjs")],
        env: {
          LOGION_MCP_BASE_URL: "http://127.0.0.1:8000",
          LOGION_MCP_ALLOW_LOOPBACK_HTTP: "1",
          LOGION_AGENT_TOKEN: token,
        },
        stderr: "pipe",
      }),
    );
    await submit({
      kind: "source",
      title: "Agent 建议的合成论文",
      doi: `10.1234/${randomUUID()}`,
      csl: { abstract: "只包含合成来源证据，供本人审阅。" },
    });
    expect(
      (await (await context.request.get(`${scope}/library/resources`)).json())
        .resources,
    ).toHaveLength(0);
    await page.reload();
    await expect(input).toHaveCount(0);
    await expect(card("文献条目")).toContainText("Agent 建议的合成论文");
    await expect(card("文献条目")).toContainText(agentName);
  });

  test("owner edits and accepts; source appears in the library; idea access fails", async () => {
    await card("文献条目")
      .getByRole("button", { name: "编辑后接受", exact: true })
      .click();
    await card("文献条目")
      .getByLabel("文献标题", { exact: true })
      .fill(sourceTitle);
    await card("文献条目")
      .getByRole("button", { name: "接受编辑后的内容", exact: true })
      .click();
    await expect(card("文献条目")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "处理状态", exact: true })
      .selectOption("accepted");
    await expect(card("文献条目")).toContainText(sourceTitle);
    await card("文献条目")
      .getByRole("link", { name: "查看文献库", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: new RegExp(sourceTitle) }),
    ).toBeVisible();
    const read = await bridge.callTool({
      name: "search_literature",
      arguments: { query: sourceTitle },
    });
    expect(JSON.parse(read.content[0].text).items[0].data.title).toBe(
      sourceTitle,
    );
    const ideas = await context.request.get(
      `http://127.0.0.1:8000/api/v1/agent/entities/research_idea/${randomUUID()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(ideas.status()).toBe(403);
    const blocked = await bridge.callTool({
      name: "read_context",
      arguments: { entity_type: "research_idea", entity_id: randomUUID() },
    });
    expect(blocked.isError).toBe(true);
    await page.goto("/settings/agents");
  });

  test("accept a private report, edit its Yjs note, and discard a separate summary", async () => {
    await submit({
      kind: "report",
      title: "合成研究报告",
      markdown_body: "证据与解释分开记录。",
    });
    await submit({
      kind: "summary",
      title: "待丢弃的摘要",
      markdown_body: "不进入正式记录。",
    });
    await page.reload();
    await card("摘要")
      .getByRole("button", { name: "丢弃", exact: true })
      .click();
    await expect(card("摘要")).toHaveCount(0);
    await card("研究报告")
      .getByRole("button", { name: "接受", exact: true })
      .click();
    await expect(card("研究报告")).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "处理状态", exact: true })
      .selectOption("accepted");
    await card("研究报告")
      .getByRole("link", { name: "打开私人笔记", exact: true })
      .click();
    const note = page.getByRole("textbox", { name: "笔记正文", exact: true });
    await expect(note).toHaveValue("证据与解释分开记录。");
    await note.fill("证据与解释分开记录。本人补充了限制条件。");
    await expect(
      page.getByRole("status").filter({ hasText: "正文已保存" }),
    ).toBeVisible();
    await page
      .getByLabel("笔记标题", { exact: true })
      .fill("本人修订的私人报告");
    await page.getByRole("button", { name: "保存标题", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "本人修订的私人报告", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(note).toHaveValue("证据与解释分开记录。本人补充了限制条件。");
    await page.goto("/settings/agents");
    await page
      .getByRole("combobox", { name: "处理状态", exact: true })
      .selectOption("discarded");
    await expect(card("摘要")).toContainText("待丢弃的摘要");
  });

  test("pending inbox is usable at four widths in both themes with no offline storage", async ({}, info) => {
    await submit({
      kind: "source",
      title: "待审阅：方法、实验与边界条件",
      csl: { abstract: "这是一条用于移动端审阅的合成文献。" },
    });
    await page.reload();
    await expect(card("文献条目")).toBeVisible();
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
        await page
          .locator(".wb-main")
          .evaluate((element) => element.scrollTo(0, 0));
        await page.screenshot({
          path: info.outputPath(`agents-${width}-${theme}.png`),
          fullPage: true,
        });
        await page
          .getByRole("heading", { name: "收件箱", exact: true })
          .evaluate((element) => element.scrollIntoView({ block: "start" }));
        await page.screenshot({
          path: info.outputPath(`agents-inbox-${width}-${theme}.png`),
          fullPage: true,
        });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await card("文献条目")
      .getByRole("button", { name: "编辑后接受", exact: true })
      .click();
    await card("文献条目")
      .getByLabel("文献标题", { exact: true })
      .fill("手机端审阅的文献");
    await card("文献条目")
      .getByRole("button", { name: "接受编辑后的内容", exact: true })
      .click();
    await expect(card("文献条目")).toHaveCount(0);
    expect(
      await page.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(0);
  });

  test("weekly review displays the number of submitted inbox items", async () => {
    await page.goto("/plan");
    await page.getByRole("button", { name: "开始周回顾", exact: true }).click();
    await expect(
      page.locator(".wb-weekly-stats > div").filter({ hasText: "Agent 投稿" }),
    ).toHaveText("Agent 投稿4");
    await page.goto("/settings/agents");
    await expect(
      page.getByRole("heading", { name: "收件箱", exact: true }),
    ).toBeVisible();
  });

  test("explicit revocation immediately returns 401 through the bridge", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const row = page
      .locator(".wb-config-list li")
      .filter({ hasText: agentName });
    await row
      .getByRole("button", { name: `撤销 ${agentName}`, exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "确认撤销", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const result = await bridge.callTool({
      name: "search_literature",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("AGENT_HTTP_401");
    const status = await context.request.get("/api/v1/research/agent-tokens");
    expect(
      (await status.json()).tokens.find(
        (value: { id: string }) => value.id === tokenId,
      ).revoked_at,
    ).not.toBeNull();
  });
});
