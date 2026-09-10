import type {
  PullResponse,
  PushRequest,
  PushResponse,
} from "../../packages/contracts/src/sync-v1";
import { hashPayload } from "../../packages/offline/src/hashing";
import type { JsonObject, LocalEntity } from "../../packages/offline/src/types";

import { expect, test } from "./fixtures";

test("real recent-auth expiry returns through login before export retry", async ({
  page,
  accountState,
}, testInfo) => {
  const configuredTtl = process.env.LOGION_E2E_RECENT_AUTH_TTL_SECONDS;
  test.skip(
    !configuredTtl,
    "Requires an isolated API with an explicit recent-auth TTL.",
  );
  const ttl = Number(configuredTtl);
  expect(Number.isInteger(ttl) && ttl >= 60 && ttl <= 1800).toBe(true);
  test.setTimeout((ttl + 120) * 1000);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/app/data");
  expect(new URL(page.url()).hostname).toMatch(
    /^(127\.0\.0\.1|localhost|\[::1\])$/,
  );
  const workspaces = await page.request.get("/api/v1/workspaces");
  expect(workspaces.status()).toBe(200);
  const workspaceId = (
    (await workspaces.json()) as {
      workspaces: Array<{ id: string }>;
    }
  ).workspaces[0]!.id;
  const collection = `/api/v1/workspaces/${workspaceId}/data-exports`;
  const exportIds = async () => {
    const response = await page.request.get(collection);
    expect(response.status()).toBe(200);
    return (
      (await response.json()) as { exports: Array<{ id: string }> }
    ).exports
      .map((item) => item.id)
      .sort();
  };
  const initialIds = await exportIds();
  // Let the real server-side session age; browser clocks and API responses stay real.
  const started = Date.parse(workspaces.headers().date!);
  expect(Number.isFinite(started)).toBe(true);
  await expect
    .poll(
      async () => {
        const session = await page.request.get("/api/v1/auth/session");
        expect(session.status()).toBe(200);
        return Date.parse(session.headers().date!) - started;
      },
      {
        timeout: (ttl + 60) * 1000,
        intervals: [1000],
      },
    )
    .toBeGreaterThan((ttl + 10) * 1000);
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )!.value;
  const refresh = await page.request.post("/api/v1/auth/refresh", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
  });
  expect(refresh.status()).toBe(200);
  await page.reload();
  await page.getByRole("button", { name: "创建导出", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "创建导出" });
  await sheet.getByLabel("输入 EXPORT 确认").fill("EXPORT");
  const rejected = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === collection,
  );
  await sheet.getByRole("button", { name: "创建导出", exact: true }).click();
  const rejection = await rejected;
  expect(rejection.status()).toBe(403);
  expect(await rejection.json()).toMatchObject({
    code: "AUTH_RECENT_LOGIN_REQUIRED",
  });
  expect(await exportIds()).toEqual(initialIds);
  await sheet.getByRole("button", { name: "取消", exact: true }).click();
  const reauthenticate = page.getByTestId("data-main").getByRole("link", {
    name: "重新登录",
    exact: true,
  });
  await expect(reauthenticate).toHaveAttribute(
    "href",
    "/auth/login?next=/app/data",
  );
  await reauthenticate.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("recent-auth-expired.png"),
  });
  await reauthenticate.click();
  await expect(page).toHaveURL(/\/auth\/login\?next=\/app\/data$/);
  await page.getByLabel("邮箱", { exact: true }).fill(accountState.email);
  await page.getByLabel("密码", { exact: true }).fill(accountState.password);
  const loginResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  expect((await loginResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/data$/);
  await expect(
    page.getByRole("link", { name: "重新登录", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "创建导出", exact: true }).click();
  await sheet.getByLabel("输入 EXPORT 确认").fill("EXPORT");
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === collection,
  );
  await sheet.getByRole("button", { name: "创建导出", exact: true }).click();
  const result = await created;
  expect(result.status()).toBe(202);
  const job = (await result.json()) as { id: string };
  expect(initialIds).not.toContain(job.id);
  expect(await exportIds()).toEqual([...initialIds, job.id].sort());
  await expect(sheet).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("recent-auth-retried.png"),
  });
});

for (const width of [1440, 320]) {
  test(`Mastery sync survives a backward clock at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app/review");
    await page.getByRole("button", { name: "解锁资料", exact: true }).click();
    const unlock = page.getByRole("dialog", { name: "解锁本地复习资料" });
    await unlock.getByLabel("本地口令").fill("m5-clock-vault-passphrase");
    await unlock.getByRole("button", { name: "解锁资料" }).click();
    await expect(unlock).toHaveCount(0);
    const title = `M5 clock ${width} ${Date.now()}`;
    await page.getByRole("button", { name: "新建知识点", exact: true }).click();
    const topic = page.getByRole("dialog", { name: "新建知识点" });
    await topic.getByLabel("名称").fill(title);
    await topic.getByRole("button", { name: "保存知识点" }).click();
    await expect(topic).toHaveCount(0);
    const topicButton = page.getByRole("button", { name: new RegExp(title) });
    const topicId = await topicButton.getAttribute("data-review-topic");
    expect(topicId).toBeTruthy();
    await topicButton.click();
    await page.getByRole("tab", { name: /掌握与图谱/ }).click();
    await page.getByRole("button", { name: "列表与掌握确认" }).click();
    await page.setViewportSize({ width, height: 900 });

    if (width === 320) {
      await page
        .getByRole("button", { name: "复习工作面", exact: true })
        .click();
    }

    type LocalMetadata = Pick<
      LocalEntity,
      | "entity_id"
      | "created_at"
      | "local_revision"
      | "server_version"
      | "payload_hash"
      | "sync_status"
    >;
    let previous: LocalMetadata | undefined;
    let occurredAt: string | undefined;
    for (const level of ["exposed", "practicing"]) {
      const confirmation = page.getByLabel(`${title} 的掌握确认`);
      await confirmation.selectOption(level);
      const pushed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/sync/push") &&
          (response.request().postDataJSON() as PushRequest).operations.some(
            (operation) =>
              operation.entity_type === "mastery" &&
              operation.payload.topic_id === topicId,
          ),
        { timeout: 20_000 },
      );
      const pulled = page.waitForResponse(
        async (response) => {
          if (!response.url().endsWith("/sync/pull") || !response.ok())
            return false;
          const body = (await response.json()) as PullResponse;
          return body.changes.some(
            (change) =>
              !change.tombstone &&
              change.entity_type === "mastery" &&
              change.payload.topic_id === topicId &&
              change.payload.confirmed_level === level,
          );
        },
        { timeout: 20_000 },
      );
      const [push, pull] = await Promise.all([
        pushed,
        pulled,
        confirmation
          .locator("..")
          .getByRole("button", { name: "确认", exact: true })
          .click(),
      ]);
      expect(push.ok()).toBe(true);
      const results = ((await push.json()) as PushResponse).results;
      expect(results.every((entry) => entry.status === "applied")).toBe(true);
      const operation = (
        push.request().postDataJSON() as PushRequest
      ).operations.find(
        (entry) =>
          entry.entity_type === "mastery" && entry.payload.topic_id === topicId,
      )!;
      const current = ((await pull.json()) as PullResponse).changes.find(
        (entry) =>
          !entry.tombstone &&
          entry.entity_type === "mastery" &&
          entry.payload.topic_id === topicId,
      )!;
      expect(current.payload_hash).toBe(
        await hashPayload(current.payload as JsonObject),
      );
      if (previous) {
        expect(operation.client_occurred_at).toBe(occurredAt);
        expect(operation.base_version).toBe(previous.server_version);
        expect(current.entity_id).toBe(previous.entity_id);
        expect(current.server_version).toBeGreaterThan(previous.server_version);
      }
      let local: LocalMetadata | null = null;
      await expect
        .poll(async () => {
          local = await page.evaluate(async (expected) => {
            const database = (await indexedDB.databases()).find(({ name }) =>
              name?.startsWith("logion-offline-v1-"),
            );
            const databaseName = database?.name;
            if (!databaseName) return null;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(databaseName);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              const entries = await new Promise<LocalEntity[]>(
                (resolve, reject) => {
                  const request = db
                    .transaction("entities")
                    .objectStore("entities")
                    .getAll();
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                },
              );
              const entry = entries.find(
                (item) =>
                  item.entity_type === "mastery" &&
                  item.entity_id === expected.entity_id,
              );
              return entry
                ? {
                    entity_id: entry.entity_id,
                    created_at: entry.created_at,
                    local_revision: entry.local_revision,
                    server_version: entry.server_version,
                    payload_hash: entry.payload_hash,
                    sync_status: entry.sync_status,
                  }
                : null;
            } finally {
              db.close();
            }
          }, current);
          return (
            local && [
              local.server_version,
              local.payload_hash,
              local.sync_status,
            ]
          );
        })
        .toEqual([current.server_version, current.payload_hash, "clean"]);
      const confirmed = local as unknown as LocalMetadata;
      if (previous) {
        expect(confirmed.created_at).toBe(previous.created_at);
        expect(confirmed.local_revision).toBeGreaterThan(
          previous.local_revision,
        );
      }
      previous = confirmed;
      occurredAt = new Date(
        Date.parse(confirmed.created_at) - 2_000,
      ).toISOString();
      await page.clock.setFixedTime(new Date(occurredAt));
    }
  });
}

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
    const exportRows = page
      .getByRole("list", { name: "数据导出任务", exact: true })
      .locator("li");
    const initialExportCount = await exportRows.count();
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
    const updated = page.waitForResponse(
      async (entry) => {
        if (
          entry.request().method() !== "GET" ||
          !/\/data-exports$/.test(new URL(entry.url()).pathname) ||
          !entry.ok()
        )
          return false;
        const job = (await (await created).json()) as { id: string };
        const body = (await entry.json()) as {
          exports: Array<{
            id: string;
            status: string;
            artifact_bytes: number;
          }>;
        };
        return body.exports.some(
          (item) => item.id === job.id && item.status === "succeeded",
        );
      },
      { timeout: 60_000 },
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
    await expect(exportRows).toHaveCount(initialExportCount + 1);
    await exportRows.first().getByRole("button").first().click();
    const detail = page.getByTestId("data-export-detail");
    await expect(detail).toContainText(/queued|running|succeeded/);
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`export-selected-${width}.png`),
    });
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
    await expect(download).toHaveAttribute(
      "href",
      new RegExp(`/data-exports/${job.id}/download$`),
    );
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

for (const width of [1440, 320]) {
  test(`T-06 mastery reason present and absent at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app/review");
    const unlock = page.getByRole("button", { name: "解锁资料", exact: true });
    await expect(unlock).toBeVisible();
    await unlock.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地复习资料" });
    await sheet.getByLabel("本地口令").fill("t06-local-vault-passphrase");
    await sheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(sheet).toHaveCount(0);
    const title = `T06 mastery ${width} ${Date.now()}`;
    await page.getByRole("button", { name: "新建知识点", exact: true }).click();
    const topic = page.getByRole("dialog", { name: "新建知识点" });
    await topic.getByLabel("名称").fill(title);
    await topic.getByRole("button", { name: "保存知识点" }).click();
    await expect(topic).toHaveCount(0);
    const topicButton = page.getByRole("button", { name: new RegExp(title) });
    const topicId = await topicButton.getAttribute("data-review-topic");
    expect(topicId).toBeTruthy();
    await topicButton.click();
    await page.getByRole("tab", { name: /掌握与图谱/ }).click();
    await page.getByRole("button", { name: "列表与掌握确认" }).click();

    let reason = "";
    let changed = 0;
    let applied: { id: string; version: number; hash: string } | null = null;
    // 仅注入渲染夹具，不把该用例当作后端生成建议的证据。
    await page.route("**/sync/pull", async (route) => {
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as {
        changes: Array<{
          entity_type: string;
          entity_id: string;
          server_version: number;
          payload: JsonObject;
          payload_hash: string;
        }>;
      };
      for (const change of body.changes ?? []) {
        if (
          change.entity_type !== "mastery" ||
          change.payload?.topic_id !== topicId
        )
          continue;
        change.payload.suggested_reason = reason;
        change.payload_hash = await hashPayload(change.payload);
        applied = {
          id: change.entity_id,
          version: change.server_version,
          hash: change.payload_hash,
        };
        changed += 1;
      }
      await route.fulfill({ response, json: body });
    });

    for (const present of [false, true]) {
      reason = present
        ? "最近三次回忆正确，建议继续练习并在真实任务中检验。长文本换行验证：".repeat(
            5,
          )
        : "";
      await page.setViewportSize({ width: 1440, height: 900 });
      const confirmation = page.getByLabel(`${title} 的掌握确认`);
      await confirmation.selectOption("exposed");
      const before = changed;
      const pushed = page.waitForResponse((response) => {
        if (!response.url().endsWith("/sync/push")) return false;
        const body = response.request().postDataJSON() as {
          operations?: Array<{ entity_type: string; payload: JsonObject }>;
        };
        return (
          body.operations?.some(
            (entry) =>
              entry.entity_type === "mastery" &&
              entry.payload.topic_id === topicId,
          ) ?? false
        );
      });
      await confirmation
        .locator("..")
        .getByRole("button", { name: "确认", exact: true })
        .click();
      const push = await pushed;
      expect(push.ok()).toBe(true);
      const pushBody = (await push.json()) as {
        results: Array<{ status: string; error_code?: string | null }>;
      };
      expect(
        pushBody.results.every((entry) =>
          ["applied", "duplicate"].includes(entry.status),
        ),
        JSON.stringify(pushBody.results),
      ).toBe(true);
      await expect.poll(() => changed).toBeGreaterThan(before);
      await expect
        .poll(async () =>
          page.evaluate(async (expected) => {
            if (!expected) return false;
            const database = (await indexedDB.databases()).find(({ name }) =>
              name?.startsWith("logion-offline-v1-"),
            );
            const databaseName = database?.name;
            if (!databaseName) return false;
            const db = await new Promise<IDBDatabase>((resolve, reject) => {
              const request = indexedDB.open(databaseName);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            try {
              return await new Promise<boolean>((resolve, reject) => {
                const request = db
                  .transaction("entities")
                  .objectStore("entities")
                  .getAll();
                request.onsuccess = () =>
                  resolve(
                    request.result.some(
                      (entry) =>
                        entry.entity_type === "mastery" &&
                        entry.entity_id === expected.id &&
                        entry.server_version === expected.version &&
                        entry.payload_hash === expected.hash &&
                        entry.sync_status === "clean",
                    ),
                  );
                request.onerror = () => reject(request.error);
              });
            } finally {
              db.close();
            }
          }, applied),
        )
        .toBe(true);
      const inspector = page.getByTestId("review-inspector");
      await expect(inspector).toContainText("已经接触");
      const label = inspector.getByText("建议依据", { exact: true });
      if (present) {
        await expect(label).toBeAttached();
        await expect(inspector).toContainText(reason);
      } else {
        await expect(label).toHaveCount(0);
      }
      await page.setViewportSize({ width, height: 900 });
      if (width === 320) {
        await page
          .getByRole("button", { name: "知识 Inspector", exact: true })
          .click();
      }
      await expect(inspector).toBeVisible();
      await inspector
        .getByRole("heading", { name: title, exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        inspector.getByText("我的确认", { exact: true }),
      ).toBeInViewport();
      await expect(
        inspector.getByText("系统建议", { exact: true }),
      ).toBeInViewport();
      if (present) {
        await expect(label).toBeInViewport();
        const bounds = await label.locator("..").evaluate((element) => ({
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
          right: element.getBoundingClientRect().right,
          viewport: window.innerWidth,
        }));
        expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.width + 1);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
      }
      // 悬停会暂停 Toast 计时，截图前先移开鼠标。
      await page.mouse.move(width - 1, 899);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      await page.screenshot({
        path: testInfo.outputPath(
          `mastery-reason-${present ? "present" : "absent"}-${width}.png`,
        ),
      });
    }
  });
}
