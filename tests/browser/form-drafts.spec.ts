import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { readLocalSnapshot } from "./local-snapshot";
import { waitForWorkbenchReady } from "./workbench-audit";

// ADR-0034: draft record IDs share this fixed first group (UUID version 8).
const DRAFT_PREFIX = "f0d4af75-";
const passphrase = "form-draft-e2e-passphrase";

async function draftRecords(page: Page) {
  const snapshot = await readLocalSnapshot(page);
  return {
    drafts: snapshot.stores.vaultRecords.filter((row) =>
      String(row.record_id).startsWith(DRAFT_PREFIX),
    ),
    raw: JSON.stringify(snapshot.stores),
  };
}

async function openReviewSheet(page: Page) {
  await page.goto("/app/review");
  await waitForWorkbenchReady(page, "/app/review");
  const unlockTrigger = page.locator("#review-unlock");
  if (await unlockTrigger.isVisible()) {
    await unlockTrigger.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地复习资料" });
    await sheet.getByLabel("本地口令").fill(passphrase);
    await sheet.getByRole("button", { name: "解锁本地资料" }).click();
    await expect(sheet).toHaveCount(0);
  }
  await page.getByRole("tab", { name: /周期审查/ }).click();
  await page.getByRole("button", { name: "创建审查", exact: true }).click();
  return page.getByRole("dialog", { name: "创建周期审查" });
}

test("Review summary survives a reload as an encrypted draft until discarded or logout", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const secret = `Unsubmitted summary ${randomUUID()}`;
  let sheet = await openReviewSheet(page);
  await expect(sheet.getByRole("group", { name: "未提交内容" })).toHaveCount(0);
  await sheet.getByLabel("总结草稿").fill(secret);
  // The draft is written after typing pauses; wait for the sealed record.
  await expect
    .poll(async () => (await draftRecords(page)).drafts.length)
    .toBe(1);
  expect((await draftRecords(page)).raw).not.toContain(secret);

  await page.reload();
  sheet = await openReviewSheet(page);
  const prompt = sheet.getByRole("group", { name: "未提交内容" });
  await expect(prompt).toContainText("恢复未提交内容？");
  // Never restored silently.
  await expect(sheet.getByLabel("总结草稿")).toHaveValue("");
  await prompt.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(sheet.getByLabel("总结草稿")).toHaveValue(secret);
  await expect(prompt).toHaveCount(0);

  // Closing without submitting keeps the draft; Discard removes it.
  await sheet.getByRole("button", { name: "取消", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("button", { name: "创建审查", exact: true }).click();
  await sheet
    .getByRole("group", { name: "未提交内容" })
    .getByRole("button", { name: "丢弃", exact: true })
    .click();
  await expect
    .poll(async () => (await draftRecords(page)).drafts.length)
    .toBe(0);

  // Logout deletes remaining drafts without the key; other records stay.
  await sheet.getByLabel("总结草稿").fill(`${secret} again`);
  await expect
    .poll(async () => (await draftRecords(page)).drafts.length)
    .toBe(1);
  await sheet.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  const after = await readLocalSnapshot(page);
  expect(
    after.stores.vaultRecords.filter((row) =>
      String(row.record_id).startsWith(DRAFT_PREFIX),
    ),
  ).toHaveLength(0);
  expect(after.stores.vaultMetadata).toHaveLength(1);
});
