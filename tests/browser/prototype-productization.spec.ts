import { expect, test, type Page } from "@playwright/test";

const email = process.env.LOGION_E2E_EMAIL;
const password = process.env.LOGION_E2E_PASSWORD;

async function signIn(page: Page) {
  await page.goto("/auth/login");
  await page.getByLabel("邮箱").fill(email ?? "");
  await page.getByLabel("密码").fill(password ?? "");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/(?:app(?:\/today)?|onboarding)$/);
  if (page.url().endsWith("/onboarding")) {
    await page.evaluate(async () => {
      const csrf = document.cookie
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith("logion_csrf="))
        ?.slice("logion_csrf=".length);
      if (!csrf) throw new Error("Missing CSRF cookie");
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const current = (await fetch("/api/v1/users/me/settings", {
          credentials: "same-origin",
        }).then((response) => response.json())) as {
          settings: Array<{ key: string; value: string; version: number }>;
        };
        const byKey = new Map(current.settings.map((item) => [item.key, item]));
        const onboarding = byKey.get("onboarding_completed");
        const updates = [
          ...(!byKey.has("persona")
            ? [
                {
                  key: "persona",
                  value: '{"activePersonaId":"self","customPersonas":[]}',
                  version: 0,
                },
              ]
            : []),
          ...(onboarding?.value !== "true"
            ? [
                {
                  key: "onboarding_completed",
                  value: "true",
                  version: onboarding?.version ?? 0,
                },
              ]
            : []),
        ];
        if (updates.length === 0) return;
        const saved = await fetch("/api/v1/users/me/settings", {
          body: JSON.stringify({ settings: updates }),
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrf,
          },
          method: "PUT",
        });
        if (saved.ok) return;
        if (saved.status !== 409) {
          throw new Error(`Setting seed failed: ${saved.status}`);
        }
      }
      throw new Error("Setting seed did not converge");
    });
    await page.goto("/app/today");
  }
}

test.describe("prototype productization", () => {
  test.skip(
    !email || !password,
    "Set LOGION_E2E_EMAIL and LOGION_E2E_PASSWORD for authenticated workbench checks.",
  );

  test.beforeEach(async ({ browserName, isMobile, page }) => {
    test.skip(
      browserName !== "chromium" || isMobile,
      "Runs once against the shared authenticated fixture.",
    );
    await signIn(page);
  });

  test("learning workbenches distinguish a locked Vault from empty data", async ({
    page,
  }) => {
    for (const [route, title] of [
      ["/app/planning", "把目标拆成可验收的学习路径"],
      ["/app/review", "把“看过”变成真正能回忆"],
      ["/app/exam", "围绕大纲覆盖与错题风险安排备考"],
      ["/app/records", "资料与笔记"],
      ["/app/self-study", "用可运行成果推动自主学习"],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "先解锁本地资料" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /当前 Space.*(?:没有|还是空)/ }),
      ).toHaveCount(0);
    }
  });

  test("knowledge and records views expose their real-data controls", async ({
    page,
  }) => {
    await page.goto("/app/review#knowledge-graph");
    await expect(page.getByRole("button", { name: "图谱" })).toBeVisible();
    await page.getByRole("button", { name: "列表与掌握确认" }).click();
    await expect(
      page.getByRole("heading", { name: "先建立知识图谱" }),
    ).toBeVisible();

    await page.goto("/app/records");
    await expect(page.getByLabel("搜索资料、笔记或附件")).toBeVisible();
    await expect(page.getByLabel("资料类型")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "前往同步中心处理附件" }),
    ).toHaveAttribute("href", "/app/sync");
  });

  test("research, collaboration and AI retain real source and permission gates", async ({
    page,
  }) => {
    await page.goto("/app/research");
    await expect(page.getByPlaceholder("论文来源 URL（可选）")).toHaveAttribute(
      "type",
      "url",
    );
    await expect(
      page.getByRole("heading", { name: "实验指标比较" }),
    ).toBeVisible();

    await page.goto("/app/collaboration");
    await expect(
      page.getByRole("heading", {
        name: /先解锁本地资料|还缺少工作台上下文/,
      }),
    ).toBeVisible();

    await page.goto("/app/ai");
    await expect(
      page.getByLabel("我已明确选择并核对上述发送来源与内容范围"),
    ).toBeVisible();
  });

  test("system workbenches expose real diagnostics and explicit integration boundaries", async ({
    page,
  }) => {
    await page.goto("/app/ai");
    const aiNavigation = page.getByRole("navigation", {
      name: "AI 路由中心分区",
    });
    await expect(
      aiNavigation.getByRole("link", { name: "运行与草稿" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "预检发送范围与预算" }),
    ).toBeVisible();

    await page.goto("/app/sync");
    await expect(
      page.getByRole("heading", { name: "真实同步拓扑与设备" }),
    ).toBeVisible();
    await expect(page.getByLabel("同步队列诊断")).toBeVisible();

    await page.goto("/app/security");
    const securityNavigation = page.getByRole("navigation", {
      name: "安全与数据主权",
    });
    await expect(
      securityNavigation.getByRole("link", { name: "审计时间线" }),
    ).toHaveAttribute("href", "/app/audit");

    await page.goto("/app/settings");
    await expect(
      page.getByRole("heading", { name: "自动化与集成边界" }),
    ).toBeVisible();
    await expect(
      page.getByText("当前版本没有通用连接器或自动化规则 CRUD", {
        exact: false,
      }),
    ).toBeVisible();

    await page.getByRole("button", { name: "打开通知中心" }).click();
    await expect(
      page.getByRole("dialog", { name: /通知中心|未读通知/ }),
    ).toBeVisible();
  });
});
