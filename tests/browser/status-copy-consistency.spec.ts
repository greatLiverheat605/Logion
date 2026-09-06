import { expect, test } from "./fixtures";

for (const width of [1440, 320]) {
  test(`T-06 login next and real export polling at ${width}px`, async ({
    page,
    accountState,
  }, testInfo) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await page.context().clearCookies();
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/auth/login?next=%2Fapp%2Fdata");
    await page.getByLabel("邮箱", { exact: true }).fill(accountState.email);
    await page.getByLabel("密码", { exact: true }).fill(accountState.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/data$/);
    const create = page.getByRole("button", { name: "创建导出", exact: true });
    await expect(create).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath(`login-next-${width}.png`),
    });
    await create.click();
    const sheet = page.getByRole("dialog", { name: "创建导出" });
    await expect(sheet).toContainText("服务端加密存储并保留 24 小时");
    await expect(sheet).toContainText("下载后为可读 ZIP");
    await expect(sheet).toContainText(
      "manifest.json、data.json、笔记 Markdown、任务 CSV 和论文 BibTeX",
    );
    await expect(sheet).toContainText("未加密，请妥善保管");
    await page.screenshot({
      path: testInfo.outputPath(`export-confirmation-${width}.png`),
    });
    await sheet.getByLabel("输入 EXPORT 确认").fill("EXPORT");
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        /\/data-exports$/.test(new URL(response.url()).pathname),
    );
    await sheet.getByRole("button", { name: "创建导出", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(202);
    const job = (await response.json()) as { id: string; status: string };
    expect(job.status).toBe("queued");
    await expect(sheet).toHaveCount(0);
    if (width === 320) {
      const switcher = page.getByRole("button", {
        name: "数据视图",
        exact: true,
      });
      if (await switcher.isVisible()) await switcher.click();
    }
    await page
      .getByTestId("data-main")
      .getByRole("button")
      .filter({ hasText: "queued" })
      .first()
      .click();
    const detail = page.getByTestId("data-export-detail");
    await expect(detail).toContainText("queued");
    await expect(detail.getByRole("link", { name: "下载 ZIP" })).toHaveCount(0);
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`export-queued-${width}.png`),
    });
    const updated = page.waitForResponse(
      async (entry) => {
        if (
          entry.request().method() !== "GET" ||
          !/\/data-exports$/.test(new URL(entry.url()).pathname) ||
          !entry.ok()
        )
          return false;
        const body = (await entry.json()) as {
          exports: Array<{
            id: string;
            status: string;
            artifact_bytes: number;
          }>;
        };
        return body.exports.some(
          (entry) => entry.id === job.id && entry.status === "succeeded",
        );
      },
      { timeout: 60_000 },
    );
    const finished = await updated;
    const payload = (await finished.json()) as {
      exports: Array<{ id: string; artifact_bytes: number }>;
    };
    const bytes = payload.exports.find(
      (entry) => entry.id === job.id,
    )!.artifact_bytes;
    expect(bytes).toBeGreaterThanOrEqual(1024);
    expect(bytes).toBeLessThan(1048576);
    await expect(detail).toContainText(`${(bytes / 1024).toFixed(1)} KB`);
    const download = detail.getByRole("link", { name: "下载 ZIP" });
    await expect(download).toBeVisible();
    await expect(detail).not.toContainText("0.0 MB");
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`export-succeeded-${width}.png`),
    });
    await download.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    await page.screenshot({
      path: testInfo.outputPath(`export-download-${width}.png`),
    });
    const artifact = await page.request.get(
      (await download.getAttribute("href"))!,
    );
    expect(artifact.status()).toBe(200);
    expect(artifact.headers()["content-type"]).toContain("application/zip");
    const archive = await artifact.body();
    expect(archive.byteLength).toBe(bytes);
    expect(archive.subarray(0, 4).toString("hex")).toBe("504b0304");
    await expect(page.locator("main")).not.toContainText("加密数据包");
  });

  for (const [answer, label] of [
    ["正确答案", "最近正确"],
    ["错误答案", "最近错误"],
  ] as const) {
    test(`T-06 ${label} recall copy at ${width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(180_000);
      page.setDefaultTimeout(15_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/app/review");
      await expect(
        page.getByRole("heading", { name: "把“看过”变成真正能回忆" }),
      ).toBeVisible();
      const unlock = page.getByRole("button", {
        name: "解锁资料",
        exact: true,
      });
      if (await unlock.isVisible()) {
        await unlock.click();
        const sheet = page.getByRole("dialog", { name: "解锁本地复习资料" });
        await sheet.getByLabel("本地口令").fill("t06-local-vault-passphrase");
        await sheet.getByRole("button", { name: "解锁资料" }).click();
        await expect(sheet).toHaveCount(0);
      }
      const title = `T06 recall ${width} ${Date.now()}`;
      await page
        .getByRole("button", { name: "新建知识点", exact: true })
        .click();
      const topic = page.getByRole("dialog", { name: "新建知识点" });
      await topic.getByLabel("名称").fill(title);
      await topic.getByRole("button", { name: "保存知识点" }).click();
      await expect(topic).toHaveCount(0);
      await page.getByRole("button", { name: new RegExp(title) }).click();
      await page.getByRole("tab", { name: /掌握与图谱/ }).click();
      await page.getByRole("button", { name: "列表与掌握确认" }).click();
      await page.getByRole("button", { name: "新建主动回忆题" }).click();
      const quiz = page.getByRole("dialog", { name: "新建主动回忆题" });
      await quiz.getByLabel("题目").fill("测试正确与错误判定");
      await quiz.getByLabel("参考答案").fill("正确答案");
      await quiz.getByRole("button", { name: "加密保存题目" }).click();
      await expect(quiz).toHaveCount(0);
      await page.getByRole("tab", { name: "到期复习" }).click();
      await page.setViewportSize({ width, height: 900 });
      if (width === 320) {
        const switcher = page.getByRole("button", {
          name: "复习工作面",
          exact: true,
        });
        if (await switcher.isVisible()) await switcher.click();
      }
      const panel = page.getByTestId("review-answer");
      await panel
        .getByRole("button", { name: "开始回忆", exact: true })
        .click();
      const sheet = page.getByRole("dialog", { name: "主动回忆" });
      await sheet.getByLabel("我的答案").fill(answer);
      await sheet.getByRole("button", { name: "提交回答" }).click();
      await sheet.getByRole("button", { name: "保存答题记录" }).click();
      await expect(sheet).toHaveCount(0);
      await expect(panel).toContainText(label);
      await expect(panel).not.toContainText(/最近(?:true|false)/);
      await panel.getByText(label, { exact: false }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: testInfo.outputPath(
          `recall-${answer === "正确答案" ? "correct" : "incorrect"}-${width}.png`,
        ),
      });
    });
  }
}
