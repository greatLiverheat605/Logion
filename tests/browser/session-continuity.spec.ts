import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import { waitForWorkbenchReady } from "./workbench-audit";

test("encrypted note survives failed sync and terminal reauthentication", async ({
  page,
  accountState,
}) => {
  test.setTimeout(120_000);
  const title = `Continuity ${randomUUID().slice(0, 8)}`;
  const content =
    "A locally committed note must survive an authentication failure.";
  await page.goto("/app/records");
  await waitForWorkbenchReady(page, "/app/records");
  const unlock = async () => {
    await page.locator("#records-unlock").click();
    const sheet = page.getByRole("dialog", { name: "解锁本地资料" });
    await sheet.getByLabel("本地口令").fill(accountState.password);
    await sheet.getByRole("button", { name: "解锁本地资料" }).click();
    await expect(sheet).toHaveCount(0);
  };
  await unlock();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建 Markdown 笔记" });
  await create.getByLabel("标题", { exact: true }).fill(title);
  await create.getByRole("button", { name: "创建笔记" }).click();
  await expect(create).toHaveCount(0);
  const body = page.getByRole("textbox", { name: "Markdown 正文" });
  await body.fill(content);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("records-save-status")).toHaveText("已保存");
  const unsaved = `${content} This edit is still in memory during refresh.`;
  await body.fill(unsaved);
  const sync = page.getByRole("button", {
    name: "同步当前 Workspace",
    exact: true,
  });
  await page.context().clearCookies({ name: "logion_access" });
  const refresh = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/auth/refresh",
  );
  await sync.click();
  expect((await refresh).status()).toBe(200);
  await expect(body).toHaveValue(unsaved);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("records-save-status")).toHaveText("已保存");
  await sync.click();
  await expect(
    page.getByText("笔记与资料索引已同步。", { exact: true }).first(),
  ).toBeVisible();
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )!.value;
  expect(
    (
      await page.request.post("/api/v1/auth/logout", {
        headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
      })
    ).status(),
  ).toBe(200);
  await sync.click();
  await page.getByRole("link", { name: "重新登录并返回" }).click();
  await page.getByLabel("邮箱", { exact: true }).fill(accountState.email);
  await page.getByLabel("密码", { exact: true }).fill(accountState.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/records$/);
  await waitForWorkbenchReady(page, "/app/records");
  await unlock();
  await page
    .getByRole("button", { name: new RegExp(`${title}，更新于`) })
    .click();
  await expect(body).toHaveValue(unsaved);
});

test("access expiry recovers the same device during bootstrap", async ({
  page,
}) => {
  const device = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_device",
  )!.value;
  await page.context().clearCookies({ name: "logion_access" });
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/auth/refresh",
  );
  await page.goto("/app/templates");
  expect((await refreshed).status()).toBe(200);
  await expect(page.locator(".app-shell-frame")).toBeVisible();
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "logion_device",
    )!.value,
  ).toBe(device);
  expect((await page.request.get("/api/v1/auth/session")).status()).toBe(200);
});

test("first rejected business request shows login and returns to the route", async ({
  page,
  accountState,
}) => {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )!.value;
  const logout = await page.request.post("/api/v1/auth/logout", {
    headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
  });
  expect(logout.status()).toBe(200);
  // Client navigation preserves SessionProvider, so a business response must
  // invalidate it rather than relying on a fresh document bootstrap.
  await page.locator('a[href="/app/templates"]').first().click();
  await expect(page.getByRole("heading", { name: "需要登录" })).toBeVisible();
  const login = page.getByRole("link", { name: "重新登录并返回" });
  await expect(login).toHaveAttribute(
    "href",
    "/auth/login?next=%2Fapp%2Ftemplates",
  );
  await login.click();
  await page.getByLabel("邮箱", { exact: true }).fill(accountState.email);
  await page.getByLabel("密码", { exact: true }).fill(accountState.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/templates$/);
  await expect(page.locator(".app-shell-frame")).toBeVisible();
});

test("explicit logout after access expiry cannot silently restore the session", async ({
  page,
}) => {
  await page.context().clearCookies({ name: "logion_access" });
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("logion_"),
    ).length,
  ).toBe(0);
  await page.goto("/app/today");
  await expect(page.getByRole("heading", { name: "需要登录" })).toBeVisible();
});

test("45 minute real session continuity without helper reauthentication", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.LOGION_E2E_CONTINUITY_SOAK !== "true",
    "Opt-in real 45 minute gate; never substitute a clock fast-forward.",
  );
  test.setTimeout(50 * 60_000);
  const start = Date.now();
  const monotonicStart = performance.now();
  const initial = await page.request.get("/api/v1/auth/session");
  expect(initial.status()).toBe(200);
  const initialServerDate = initial.headers().date;
  const initialDevice = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_device",
  )!.value;
  const events: Array<{ at: string; path: string; status: number }> = [];
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (["/api/v1/auth/refresh", "/api/v1/auth/login"].includes(path)) {
      events.push({
        at: new Date().toISOString(),
        path,
        status: response.status(),
      });
    }
  });
  const samples: Array<{
    elapsedMs: number;
    serverDate: string | undefined;
    expiresAt: string;
  }> = [];
  try {
    let sample = 0;
    while (performance.now() - monotonicStart < 45 * 60_000) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
      const session = await page.request.get("/api/v1/auth/session");
      expect(session.status()).toBe(200);
      samples.push({
        elapsedMs: performance.now() - monotonicStart,
        serverDate: session.headers().date,
        expiresAt: (await session.json()).session_expires_at,
      });
      if (sample++ % 2 === 0) {
        const route = sample % 4 === 1 ? "/app/templates" : "/app/workspaces";
        await page.locator(`a[href="${route}"]`).first().click();
        await expect(page.locator(".app-shell-frame")).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "需要登录" }),
        ).toHaveCount(0);
      }
    }
    expect(Date.now() - start).toBeGreaterThanOrEqual(45 * 60_000);
    expect(
      events.filter((event) => event.path === "/api/v1/auth/login"),
    ).toEqual([]);
    expect(
      events.filter((event) => event.path === "/api/v1/auth/refresh").length,
    ).toBeGreaterThanOrEqual(3);
    expect(events.every((event) => event.status === 200)).toBe(true);
    expect(
      new Set(samples.map((sample) => sample.expiresAt)).size,
    ).toBeGreaterThanOrEqual(4);
    expect(
      (await page.context().cookies()).find(
        (cookie) => cookie.name === "logion_device",
      )!.value,
    ).toBe(initialDevice);
  } finally {
    await testInfo.attach("session-continuity-evidence", {
      body: JSON.stringify(
        {
          startedAt: new Date(start).toISOString(),
          finishedAt: new Date().toISOString(),
          monotonicElapsedMs: performance.now() - monotonicStart,
          initialServerDate,
          events,
          samples,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  }
});
