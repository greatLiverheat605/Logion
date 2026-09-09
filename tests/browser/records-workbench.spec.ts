import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import {
  assertGlmPrimaryContract,
  assertGlmRouteRegions,
  assertGlmShellGeometry,
  assertGlmWorkbenchGeometry,
  loadGlmTargetManifest,
} from "./glm-conformance";
import {
  assertNoHorizontalOverflow,
  assertPrimaryActionContract,
  assertReducedMotion,
  captureEvidenceScreenshot,
  waitForWorkbenchReady,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function seedDeletionScope(page: Page, referenced = false) {
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "logion_csrf",
  )!.value;
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, {
      data,
      headers: { Origin: new URL(page.url()).origin, "X-CSRF-Token": csrf },
    });
    expect(
      response.ok(),
      `Deletion fixture ${path}: ${response.status()}`,
    ).toBe(true);
    return response.json();
  };
  const workspaces = await (
    await page.request.get("/api/v1/workspaces")
  ).json();
  const workspaceId = workspaces.workspaces[0].id;
  const spaces = await (
    await page.request.get(`/api/v1/workspaces/${workspaceId}/spaces`)
  ).json();
  const spaceId = spaces.spaces.find(
    (space: { visibility: string }) => space.visibility === "private",
  ).id;
  const path = `/api/v1/workspaces/${workspaceId}/spaces/${spaceId}`;
  const goalId = randomUUID();
  const taskId = randomUUID();
  const noteId = randomUUID();
  const marker = `T05-${randomUUID().slice(0, 8)}`;
  await post(`${path}/goals`, {
    goal_id: goalId,
    plan_id: randomUUID(),
    plan_version_id: randomUUID(),
    title: `${marker} Goal`,
    desired_outcome: "Deletion browser verification",
    weekly_minutes: 60,
    phases: [
      {
        id: randomUUID(),
        title: "Verification",
        position: 0,
        estimated_minutes: 60,
        acceptance_criteria: ["Atomic deletion"],
      },
    ],
  });
  await post(`${path}/tasks`, {
    id: taskId,
    goal_id: goalId,
    title: `${marker} Task`,
    planned_at: new Date().toISOString(),
  });
  await post(`${path}/notes`, {
    id: noteId,
    task_id: taskId,
    title: `${marker} Note`,
    markdown_body: "Recoverable note content",
  });
  const addReference = async () => {
    await post(`${path}/tasks/${taskId}/transition`, {
      expected_version: 1,
      status: "in_progress",
    });
    await post(`${path}/evidence`, {
      evidence_id: randomUUID(),
      verification_id: randomUUID(),
      task_id: taskId,
      evidence_type: "note",
      note_id: noteId,
      summary: "Retained reference",
    });
  };
  if (referenced) await addReference();
  return { marker, path, workspaceId, goalId, taskId, noteId, addReference };
}

async function openDeletionWorkbench(
  page: Page,
  password: string,
  kind: "Goal" | "Task" | "Note",
  marker: string,
) {
  const route =
    kind === "Goal" ? "planning" : kind === "Task" ? "today" : "records";
  // Today performs the initial server bootstrap when its Vault is unlocked.
  await page.goto("/app/today");
  await waitForWorkbenchReady(page, "/app/today");
  await page.getByLabel("本地资料口令").fill(password);
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "本地资料已解锁" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "立即同步", exact: true }).click();
  await expect(
    page.getByText("本地修改已与服务器同步。", { exact: true }).first(),
  ).toBeVisible();
  await page.goto(`/app/${route}`);
  await waitForWorkbenchReady(page, `/app/${route}`);
  if (kind === "Task") {
    const input = page.getByLabel("本地资料口令");
    if (await input.isVisible()) {
      await input.fill(password);
      await page.getByRole("button", { name: "解锁", exact: true }).click();
    }
  } else {
    const trigger = page
      .getByRole("button", { name: "解锁资料", exact: true })
      .first();
    if (await trigger.isVisible()) {
      await trigger.click();
      const unlock = page.getByRole("dialog", { name: "解锁本地资料" });
      await unlock.getByLabel("本地口令").fill(password);
      await unlock.getByRole("button", { name: "解锁资料" }).click();
      await expect(unlock).toHaveCount(0);
    }
  }
  const list = page.getByTestId(
    kind === "Goal"
      ? "planning-goals"
      : kind === "Task"
        ? "today-queue"
        : "records-tree",
  );
  const row = list
    .getByRole("button", { name: new RegExp(`${marker} ${kind}`) })
    .first();
  await expect(row).toBeVisible();
  await row.click();
}

for (const kind of ["Goal", "Task", "Note"] as const) {
  test(`T05 ${kind} deletion confirms scope and clears the Inspector`, async ({
    accountState,
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    const scope = await seedDeletionScope(page);
    await openDeletionWorkbench(
      page,
      process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password,
      kind,
      scope.marker,
    );
    const label =
      kind === "Goal"
        ? "删除学习目标"
        : kind === "Task"
          ? "删除任务"
          : "删除笔记";
    const trigger = page.getByRole("button", { name: label, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "确认删除", exact: true });
    await expect(
      dialog.getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("button", { name: "确认删除", exact: true }),
    ).toBeEnabled();
    await expect(dialog).toContainText(
      kind === "Task" ? "1 个解除任务关联的笔记" : "1 个笔记",
    );
    if (kind === "Goal") await expect(dialog).toContainText("1 个任务");
    for (const width of [1440, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(
        (theme) => {
          document.documentElement.dataset.theme = theme;
        },
        width === 320 ? "dark" : "light",
      );
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      const confirm = await dialog
        .getByRole("button", { name: "确认删除", exact: true })
        .boundingBox();
      expect(confirm!.x).toBeGreaterThanOrEqual(0);
      expect(confirm!.y + confirm!.height).toBeLessThanOrEqual(900);
      await page.screenshot({
        path: testInfo.outputPath(`delete-${kind}-${width}.png`),
      });
    }
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toHaveCount(0);
    await expect(
      page.getByText("删除已同步。", { exact: true }).first(),
    ).toBeVisible();
    const entityType =
      kind === "Goal" ? "learning_goal" : kind === "Task" ? "task" : "note";
    const id =
      kind === "Goal"
        ? scope.goalId
        : kind === "Task"
          ? scope.taskId
          : scope.noteId;
    const preview = await page.request.get(
      `/api/v1/workspaces/${scope.workspaceId}/sync/deletion-preview/${entityType}/${id}`,
    );
    expect(preview.ok()).toBe(true);
    expect((await preview.json()).can_delete).toBe(false);
  });
}

test("T05 referenced Note and unavailable preview cannot be confirmed", async ({
  accountState,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const scope = await seedDeletionScope(page, true);
  await openDeletionWorkbench(
    page,
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password,
    "Note",
    scope.marker,
  );
  await page.setViewportSize({ width: 320, height: 568 });
  const trigger = page.getByRole("button", { name: "删除笔记", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "确认删除", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("1 条证据引用此笔记");
  await expect(
    dialog.getByRole("button", { name: "确认删除", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("referenced-note-320.png"),
  });
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.context().setOffline(true);
  try {
    await trigger.click();
    await expect(dialog.getByRole("alert")).toContainText("无法核对删除范围");
    await expect(
      dialog.getByRole("button", { name: "确认删除", exact: true }),
    ).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("unavailable-preview-320.png"),
    });
  } finally {
    await page.context().setOffline(false);
  }
});

test("T05 reference added after preview keeps rejection visible after local refresh", async ({
  accountState,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const scope = await seedDeletionScope(page);
  await openDeletionWorkbench(
    page,
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password,
    "Note",
    scope.marker,
  );
  await page.getByRole("button", { name: "删除笔记", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认删除", exact: true });
  await expect(
    dialog.getByRole("button", { name: "确认删除", exact: true }),
  ).toBeEnabled();
  await scope.addReference();
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const inline = page
    .locator("main")
    .getByText(/删除尚未完成.*SYNC_DELETE_BLOCKED_BY_REFERENCE/);
  await expect(inline).toBeVisible();
  await expect(page.getByText("删除已同步。", { exact: true })).toHaveCount(0);
  await expect(
    page
      .getByTestId("records-tree")
      .getByRole("button", { name: new RegExp(`${scope.marker} Note`) }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "删除笔记", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("late-reference-refusal.png"),
  });
});

test("T05 offline Note deletion resolves a concurrent device update explicitly", async ({
  accountState,
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const scope = await seedDeletionScope(page);
  const password =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  await openDeletionWorkbench(page, password, "Note", scope.marker);
  const snapshot = (readPayload = false) =>
    page.evaluate(
      async ({ workspaceId, noteId, readPayload, passphrase }) => {
        const result: Record<string, Record<string, unknown>[]> = {};
        for (const { name } of await indexedDB.databases()) {
          if (!name) continue;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            if (!db.objectStoreNames.contains("conflicts")) continue;
            for (const store of ["entities", "outbox", "conflicts"]) {
              const rows = await new Promise<Record<string, unknown>[]>(
                (resolve, reject) => {
                  const request = db
                    .transaction(store)
                    .objectStore(store)
                    .getAll();
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                },
              );
              result[store] = rows.filter(
                (row) =>
                  row.workspace_id === workspaceId && row.entity_id === noteId,
              );
            }
            if (readPayload) {
              const read = <T>(store: string) =>
                new Promise<T[]>((resolve, reject) => {
                  const request = db
                    .transaction(store)
                    .objectStore(store)
                    .getAll();
                  request.onsuccess = () => resolve(request.result);
                  request.onerror = () => reject(request.error);
                });
              const [metadata] = await read<{
                salt: string;
                iterations: number;
              }>("vaultMetadata");
              const records = await read<{
                record_id: string;
                iv: string;
                ciphertext: string;
              }>("vaultRecords");
              const payload = result.entities[0].payload as {
                encrypted_payload_ref: string;
              };
              const record = records.find(
                (row) => row.record_id === payload.encrypted_payload_ref,
              );
              if (!metadata || !record)
                throw new Error("Expected persisted encrypted Note");
              const decode = (value: string) =>
                Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
              const encoder = new TextEncoder();
              const material = await crypto.subtle.importKey(
                "raw",
                encoder.encode(passphrase),
                "PBKDF2",
                false,
                ["deriveKey"],
              );
              const key = await crypto.subtle.deriveKey(
                {
                  name: "PBKDF2",
                  hash: "SHA-256",
                  salt: decode(metadata.salt),
                  iterations: metadata.iterations,
                },
                material,
                { name: "AES-GCM", length: 256 },
                false,
                ["decrypt"],
              );
              const plaintext = await crypto.subtle.decrypt(
                {
                  name: "AES-GCM",
                  iv: decode(record.iv),
                  additionalData: encoder.encode(
                    `${workspaceId}:${record.record_id}`,
                  ),
                },
                key,
                decode(record.ciphertext),
              );
              result.payloads = [
                JSON.parse(new TextDecoder().decode(plaintext)) as Record<
                  string,
                  unknown
                >,
              ];
            }
          } finally {
            db.close();
          }
        }
        return result;
      },
      {
        workspaceId: scope.workspaceId,
        noteId: scope.noteId,
        readPayload,
        passphrase: password,
      },
    );
  await expect
    .poll(async () => (await snapshot()).entities[0]?.sync_status)
    .toBe("clean");
  const version = (await snapshot()).entities[0].server_version;
  const origin = new URL(page.url()).origin;
  const other = await browser.newContext({
    baseURL: origin,
    serviceWorkers: "block",
  });
  try {
    const login = await other.request.post("/api/v1/auth/login", {
      headers: { Origin: origin },
      data: {
        email: accountState.email,
        password: accountState.password,
        device_name: "Deletion conflict device B",
      },
    });
    expect(login.status()).toBe(200);
    const csrf = (await other.cookies()).find(
      (cookie) => cookie.name === "logion_csrf",
    )!.value;
    await page.getByRole("button", { name: "删除笔记", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "确认删除", exact: true });
    const confirm = dialog.getByRole("button", {
      name: "确认删除",
      exact: true,
    });
    await expect(confirm).toBeEnabled();
    await page.context().setOffline(true);
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(async () => (await snapshot()).outbox.length).toBe(1);
    await expect
      .poll(async () => (await snapshot()).outbox[0]?.outbox_state)
      .toBe("pending");
    expect((await snapshot()).outbox[0]).toMatchObject({
      operation_type: "delete",
      base_version: version,
    });
    expect((await snapshot()).entities[0].deleted_at).toEqual(
      expect.any(String),
    );
    await expect(page.getByText("删除已同步。", { exact: true })).toHaveCount(
      0,
    );
    const remoteTitle = `${scope.marker} Note remote`;
    const updated = await other.request.put(
      `${scope.path}/notes/${scope.noteId}`,
      {
        headers: { Origin: origin, "X-CSRF-Token": csrf },
        data: {
          expected_version: version,
          task_id: scope.taskId,
          title: remoteTitle,
          markdown_body: "Device B preserved content",
        },
      },
    );
    expect(updated.status()).toBe(200);
    const remoteVersion = (await updated.json()).version;
    await page.context().setOffline(false);
    await page.goto("/app/sync");
    const input = page.getByLabel("本地解锁口令", { exact: true });
    await expect(input).toBeVisible();
    await input.fill(password);
    await page.getByRole("button", { name: "解锁资料", exact: true }).click();
    await expect(input).toHaveCount(0);
    await page.getByRole("button", { name: "立即同步", exact: true }).click();
    await expect
      .poll(async () => (await snapshot()).outbox[0]?.outbox_state)
      .toBe("conflict");
    expect((await snapshot()).conflicts[0]).toMatchObject({
      conflict_kind: "delete_update",
      status: "open",
      remote_version: remoteVersion,
    });
    await page.getByRole("tab", { name: /冲突/ }).click();
    const panel = page.getByTestId("sync-conflicts");
    await expect(panel).toContainText(remoteTitle);
    await expect(panel).toContainText("Device B preserved content");
    await page.screenshot({
      path: testInfo.outputPath("offline-delete-update-conflict.png"),
    });
    await panel
      .getByRole("button", { name: "采用服务器版本", exact: true })
      .click();
    await expect.poll(async () => (await snapshot()).outbox.length).toBe(0);
    await expect
      .poll(
        async () =>
          (await snapshot()).conflicts.filter((row) => row.status === "open")
            .length,
      )
      .toBe(0);
    expect((await snapshot()).entities[0]).toMatchObject({
      sync_status: "clean",
      server_version: remoteVersion,
      deleted_at: null,
    });
    const cold = await other.newPage();
    await openDeletionWorkbench(cold, password, "Note", scope.marker);
    await expect(
      cold.getByRole("textbox", { name: "笔记标题", exact: true }),
    ).toHaveValue(remoteTitle);
    await expect(
      cold.getByRole("textbox", { name: "Markdown 正文", exact: true }),
    ).toHaveValue("Device B preserved content");
    await page.reload();
    // Read persisted ciphertext before unlocking or synchronizing can repair it.
    expect((await snapshot(true)).payloads[0]).toMatchObject({
      title: remoteTitle,
      markdown_body: "Device B preserved content",
    });
    const unlock = page.getByLabel("本地解锁口令", { exact: true });
    await unlock.fill(password);
    await page.getByRole("button", { name: "解锁资料", exact: true }).click();
    await expect(unlock).toHaveCount(0);
    await expect.poll(async () => (await snapshot()).outbox.length).toBe(0);
    expect((await snapshot()).entities[0]).toMatchObject({
      sync_status: "clean",
      server_version: remoteVersion,
      deleted_at: null,
    });
  } finally {
    await page.context().setOffline(false);
    await other.close();
  }
});

test("Note preview exposes only safe external URLs at desktop and mobile widths", async ({
  accountState,
  page,
}, testInfo) => {
  await page.goto("/app/records");
  await waitForWorkbenchReady(page, "/app/records");
  await page
    .getByRole("button", { name: "解锁资料", exact: true })
    .first()
    .click();
  const unlock = page.getByRole("dialog", { name: "解锁本地资料" });
  await unlock
    .getByLabel("本地口令")
    .fill(
      process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password,
    );
  await unlock.getByRole("button", { name: "解锁资料" }).click();
  await expect(unlock).toHaveCount(0);
  await page.getByRole("button", { name: "新建笔记" }).click();
  const create = page.getByRole("dialog", { name: "新建 Markdown 笔记" });
  await create.getByLabel("标题").fill("T-05 safe external links");
  await create.getByRole("button", { name: "创建笔记" }).click();
  await expect(create).toHaveCount(0);
  const longUrl = `https://example.com/${"long-path".repeat(20)}`;
  await page
    .getByRole("textbox", { name: "Markdown 正文" })
    .fill(
      `https://example.com\nhttp://example.org\n${longUrl}\njavascript:alert(1)\ndata:text/html,unsafe\nfile:///etc/passwd\n[link](https://example.net)\n<img src=x onerror=alert(1)>`,
    );
  await page.getByRole("radio", { name: "安全预览" }).click();
  const externalLinks = page.getByRole("list", { name: "笔记外部链接" });
  const links = externalLinks.getByRole("link");
  await expect(links).toHaveCount(3);
  for (const link of await links.all()) {
    await expect(link).toHaveAttribute("href", /^https?:\/\//);
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect(link).toHaveAttribute("target", "_blank");
  }
  await expect(
    page.locator(".product-markdown-preview a, .product-markdown-preview img"),
  ).toHaveCount(0);
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 720) {
      await expect
        .poll(() =>
          page
            .getByTestId("app-sidebar")
            .evaluate((element) => element.getBoundingClientRect().right),
        )
        .toBeLessThanOrEqual(0);
    }
    await externalLinks.scrollIntoViewIfNeeded();
    await expect(externalLinks).toBeVisible();
    expect(
      await externalLinks.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`note-links-${width}.png`),
    });
  }
});

test("Records completes real encrypted object workflows at four breakpoints", async ({
  accountState,
  page,
}) => {
  test.setTimeout(300_000);
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright")
      return;
    if (["error", "warning"].includes(entry.type())) {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) =>
    runtimeProblems.push(`pageerror: ${error.message}`),
  );

  const vaultPassphrase =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const glmManifest = loadGlmTargetManifest();
  const marker = `B3-${Date.now()}`;

  await page.goto("/app/records", { waitUntil: "domcontentloaded" });
  await waitForWorkbenchReady(page, "/app/records");
  await expect(page.getByTestId("records-tree")).toBeAttached();

  if (
    await page
      .getByRole("button", { name: "解锁资料", exact: true })
      .first()
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "解锁资料", exact: true })
      .first()
      .click();
    const unlockSheet = page.getByRole("dialog", { name: "解锁本地资料" });
    await expect(unlockSheet.getByLabel("本地口令")).toBeFocused();
    await unlockSheet.getByLabel("本地口令").fill(vaultPassphrase);
    await unlockSheet.getByRole("button", { name: "解锁资料" }).click();
    await expect(unlockSheet).toHaveCount(0);
  }
  await expect(
    page.getByText(/本地资料已解锁|已在应用内解锁/).first(),
  ).toBeVisible();

  const newNoteTrigger = page.getByRole("button", { name: "新建笔记" });
  await newNoteTrigger.click();
  const newNoteSheet = page.getByRole("dialog", { name: "新建 Markdown 笔记" });
  await expect(newNoteSheet.getByLabel("标题")).toBeFocused();
  const noteTitle = `${marker} 真实笔记`;
  await newNoteSheet.getByLabel("标题").fill(noteTitle);
  await newNoteSheet.getByRole("button", { name: "创建笔记" }).click();
  await expect(newNoteSheet).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "笔记标题" })).toHaveValue(
    noteTitle,
  );

  const noteBody = `# ${marker} 真实笔记\n\n## 证据\n\n- sync-v1\n- Yjs\n\n<script>alert("blocked")</script>`;
  await page.getByRole("textbox", { name: "Markdown 正文" }).fill(noteBody);
  await expect(page.getByTestId("records-save-status")).toContainText("未保存");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("records-save-status")).toContainText("已保存");

  const renamedNoteTitle = `${noteTitle} · 修订`;
  await page.getByRole("textbox", { name: "笔记标题" }).fill(renamedNoteTitle);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("records-save-status")).toContainText("已保存");

  await page.getByRole("radio", { name: "安全预览" }).click();
  await expect(
    page.getByText('<script>alert("blocked")</script>'),
  ).toBeVisible();
  await expect(
    page.getByTestId("records-editor").locator("script"),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: "编辑" }).click();

  const linkTitle = `${marker} HTTP 资料`;
  await page.getByRole("button", { name: /登记资料/ }).click();
  await page.getByRole("menuitem", { name: "HTTP(S) 链接" }).click();
  const linkSheet = page.getByRole("dialog", { name: "登记 HTTP(S) 链接" });
  await linkSheet.getByLabel("名称").fill(linkTitle);
  await linkSheet.getByLabel("HTTP(S) 地址").fill("https://example.com/raft");
  await linkSheet.getByRole("button", { name: "保存链接" }).click();
  await expect(linkSheet).toHaveCount(0);
  await expect(page.getByText(linkTitle, { exact: true })).toBeVisible();

  const pdfTitle = `${marker} PDF 索引`;
  await page.getByRole("button", { name: /登记资料/ }).click();
  await page.getByRole("menuitem", { name: "PDF 页码索引" }).click();
  const pdfSheet = page.getByRole("dialog", { name: "登记 PDF 页码索引" });
  await pdfSheet.getByLabel("名称").fill(pdfTitle);
  await pdfSheet.getByLabel("PDF 文件名").fill(`${marker}.pdf`);
  await pdfSheet.getByLabel("总页数").fill("20");
  await pdfSheet.getByLabel("索引页").fill("7");
  await pdfSheet.getByLabel("索引标签").fill("一致性证明");
  await pdfSheet.getByLabel("页码笔记").fill("只保存页码定位，不上传正文。");
  await pdfSheet.getByRole("button", { name: "保存索引" }).click();
  await expect(pdfSheet).toHaveCount(0);
  await expect(page.getByText(pdfTitle, { exact: true })).toBeVisible();

  const linkRow = page.locator("article").filter({ hasText: linkTitle });
  await linkRow.getByRole("button", { name: `重命名 ${linkTitle}` }).click();
  const renameSheet = page.getByRole("dialog", { name: "重命名资料" });
  const renamedLinkTitle = `${linkTitle} · 已校验`;
  await renameSheet.getByLabel("资料名称").fill(renamedLinkTitle);
  await renameSheet.getByRole("button", { name: "保存名称" }).click();
  await expect(renameSheet).toHaveCount(0);
  await expect(page.getByText(renamedLinkTitle, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "添加附件" }).click();
  const attachmentSheet = page.getByRole("dialog", { name: "添加笔记附件" });
  const attachmentName = `${marker}.txt`;
  await attachmentSheet.getByLabel("附件").setInputFiles({
    buffer: Buffer.from(`Records real attachment ${marker}`, "utf8"),
    mimeType: "text/plain",
    name: attachmentName,
  });
  await attachmentSheet.getByRole("button", { name: "加入附件队列" }).click();
  await expect(attachmentSheet).toHaveCount(0);
  const attachmentRegion = page.getByTestId("records-attachments");
  await expect(
    attachmentRegion.getByText(attachmentName, { exact: true }),
  ).toBeAttached();
  await expect(
    attachmentRegion.getByText(/^sha256:[a-f0-9]{64}$/),
  ).toBeAttached();

  const search = page.getByRole("searchbox", { name: "搜索笔记、资料或附件" });
  await search.fill(marker);
  await expect(page.getByText(renamedNoteTitle, { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "PDF" }).click();
  await expect(page.getByText(pdfTitle, { exact: true })).toBeVisible();
  await expect(page.getByText(renamedNoteTitle, { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("radio", { name: "全部" }).click();
  await search.fill("");

  const noteRows = page.getByTestId("records-tree").getByRole("button", {
    name: /更新于/,
  });
  if ((await noteRows.count()) > 1) {
    await noteRows.first().focus();
    await noteRows.first().press("ArrowDown");
    await expect(noteRows.nth(1)).toBeFocused();
  }

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/records");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/records", viewport);
    await assertGlmRouteRegions(page, glmManifest, "/app/records");
    await assertGlmShellGeometry(page, glmManifest);
    await assertGlmWorkbenchGeometry(page, glmManifest);
    await assertGlmPrimaryContract(page, glmManifest, "/app/records");
    if (viewport.width < 720) {
      const order = await page
        .locator(
          '[data-testid="records-tree"], [data-testid="records-editor"], [data-testid="records-inspector"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => ({
            id: element.getAttribute("data-testid"),
            top: Math.round(element.getBoundingClientRect().top + scrollY),
          })),
        );
      expect(order.map((item) => item.id)).toEqual([
        "records-tree",
        "records-editor",
        "records-inspector",
      ]);
      expect(
        order.every(
          (item, index) => index === 0 || item.top >= order[index - 1]!.top,
        ),
        `Records ${viewport.label} must keep a continuous vertical flow: ${JSON.stringify(order)}`,
      ).toBe(true);
    }
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(
      axe.violations,
      `Records ${viewport.label} must have no automated WCAG violations`,
    ).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/records", viewport);
    await assertPrimaryActionContract(page, "/app/records", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/records", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await page.setViewportSize(WORKBENCH_VIEWPORTS[3]);
  await newNoteTrigger.click();
  await expect(
    page.getByRole("dialog", { name: "新建 Markdown 笔记" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "新建 Markdown 笔记" }),
  ).toHaveCount(0);
  await expect(newNoteTrigger).toBeFocused();

  expect(
    runtimeProblems,
    "Records must not emit browser warnings or errors",
  ).toEqual([]);
});
