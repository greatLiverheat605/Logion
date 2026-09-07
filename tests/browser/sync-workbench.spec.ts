import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function localSnapshot(page: Page) {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const snapshots: Record<string, Record<string, unknown>[]> = {};
    for (const { name } of databases) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!db.objectStoreNames.contains("attachmentQueue")) {
        db.close();
        continue;
      }
      try {
        for (const store of Array.from(db.objectStoreNames)) {
          const rows = await new Promise<Record<string, unknown>[]>(
            (resolve, reject) => {
              const request = db.transaction(store).objectStore(store).getAll();
              request.onsuccess = () =>
                resolve(request.result as Record<string, unknown>[]);
              request.onerror = () => reject(request.error);
            },
          );
          for (const row of rows) {
            if (row.blob instanceof Blob) {
              row.blob = {
                size: row.blob.size,
                type: row.blob.type,
                digest: Array.from(
                  new Uint8Array(
                    await crypto.subtle.digest(
                      "SHA-256",
                      await row.blob.arrayBuffer(),
                    ),
                  ),
                ),
              };
            }
          }
          snapshots[store] = rows;
        }
      } finally {
        db.close();
      }
    }
    return snapshots;
  });
}

test("T05a removes one failed local attachment offline and preserves other data", async ({
  accountState,
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const password =
    process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password;
  const marker = `T05a-${Date.now()}`;
  const failedName = `${marker}-remove.txt`;
  const keepName = `${marker}-keep.txt`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByLabel("本地资料口令").fill(password);
  await page.getByRole("button", { name: "解锁", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "本地资料已解锁" }),
  ).toBeVisible();
  await page.locator('a[href="/app/records"]').first().click();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const note = page.getByRole("dialog", { name: "新建 Markdown 笔记" });
  await note.getByLabel("标题", { exact: true }).fill(marker);
  await note.getByRole("button", { name: "创建笔记", exact: true }).click();
  await expect(note).toHaveCount(0);
  for (const name of [failedName, keepName]) {
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加笔记附件" });
    await dialog.getByLabel("附件", { exact: true }).setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(`Local attachment ${name}`),
    });
    await dialog
      .getByRole("button", { name: "加入附件队列", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  }
  await page.context().setOffline(true);
  await page
    .getByRole("textbox", { name: "笔记标题" })
    .fill(`${marker} offline`);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(async () => (await localSnapshot(page)).outbox.length)
    .toBeGreaterThan(0);
  await expect(page.getByTestId("records-save-status")).toContainText("已保存");
  expect((await localSnapshot(page)).outbox.length).toBeGreaterThan(0);
  await page.context().setOffline(false);
  await page.locator('a[href="/app/sync"]').first().click();
  const attachmentTab = page.getByRole("tab", { name: /附件队列/ });
  await expect(attachmentTab).toBeVisible();
  const unlock = page.getByLabel("本地解锁口令");
  if (await unlock.isVisible()) {
    await unlock.fill(password);
    await page.getByRole("button", { name: "解锁资料", exact: true }).click();
  }
  await expect(attachmentTab).toContainText("2");
  await attachmentTab.click();
  const queue = page.getByTestId("sync-attachments");
  await expect(queue).toContainText(keepName);
  await page.context().setOffline(true);
  await queue
    .getByRole("button", { name: "上传并验证", exact: true })
    .first()
    .click();
  const remove = queue.getByRole("button", {
    name: `移除附件「${failedName}」`,
  });
  await expect(remove).toBeVisible();
  const before = await localSnapshot(page);
  expect(before.attachmentQueue).toHaveLength(2);
  expect(before.entities.length).toBeGreaterThan(0);
  expect(before.vaultRecords.length).toBeGreaterThan(0);
  expect(before.vaultMetadata.length).toBeGreaterThan(0);
  expect(before.outbox.length).toBeGreaterThan(0);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.startsWith("/api/") ||
      !["GET", "HEAD"].includes(request.method())
    ) {
      requests.push(request.url());
    }
  });

  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await remove.click();
    const dialog = page.getByRole("dialog", { name: "移除失败附件" });
    const cancel = dialog.getByRole("button", { name: "取消", exact: true });
    await expect(cancel).toBeFocused();
    await expect(dialog).toContainText(failedName);
    await expect(page.locator("[data-sonner-toaster]")).toBeHidden();
    await expect(
      dialog.getByRole("heading", { name: "移除失败附件" }),
    ).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`t05a-confirm-${width}.png`),
      fullPage: true,
    });
    if (width === 1440) await cancel.click();
    else await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(remove).toBeFocused();
    expect(await localSnapshot(page)).toEqual(before);
  }

  await remove.click();
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "移除失败附件" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("heading", { name: "附件上传队列" }),
  ).toBeFocused();
  await expect(queue).not.toContainText(failedName);
  await expect(queue).toContainText(keepName);
  expect(await localSnapshot(page)).toEqual({
    ...before,
    attachmentQueue: before.attachmentQueue.filter(
      (row) => row.filename !== failedName,
    ),
  });
  expect(requests).toEqual([]);
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("t05a-removed-320.png"),
    fullPage: true,
  });

  await page.context().setOffline(false);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByLabel("本地解锁口令").fill(password);
  await page.getByRole("button", { name: "解锁资料", exact: true }).click();
  await expect(attachmentTab).toContainText("1");
  await page.getByRole("tab", { name: /附件队列/ }).click();
  await expect(queue).toContainText(keepName);
  await expect(queue).not.toContainText(failedName);
  expect((await localSnapshot(page)).attachmentQueue).toEqual(
    before.attachmentQueue.filter((row) => row.filename !== failedName),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("t05a-reloaded-1440.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
