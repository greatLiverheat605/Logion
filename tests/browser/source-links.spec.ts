import { randomUUID } from "node:crypto";

import { expect, test } from "./fixtures";
import { waitForWorkbenchReady } from "./workbench-audit";

// ADR-0033: requires LOGION_SOURCE_LINKS_ENABLED on the API (Nightly and Release).
test("Review links a topic back to the note selection it came from", async ({
  page,
  accountState,
}) => {
  test.setTimeout(120_000);
  const marker = `Source ${randomUUID().slice(0, 8)}`;
  const excerpt = "Majority quorums overlap.";
  const bodyText = `Intro paragraph.\n${excerpt}\nClosing paragraph.`;
  await page.goto("/app/records");
  await waitForWorkbenchReady(page, "/app/records");
  await page.locator("#records-unlock").click();
  const unlock = page.getByRole("dialog", { name: "解锁本地资料" });
  await unlock
    .getByLabel("本地口令")
    .fill(
      process.env.LOGION_E2E_VAULT_PASSPHRASE?.trim() || accountState.password,
    );
  await unlock.getByRole("button", { name: "解锁本地资料" }).click();
  await expect(unlock).toHaveCount(0);
  const sync = async () => {
    await page
      .getByRole("button", { name: "同步当前 Workspace", exact: true })
      .click();
    await expect(
      page.getByText("笔记与资料索引已同步。", { exact: true }).first(),
    ).toBeVisible();
  };
  await sync();
  await page.getByRole("button", { name: "新建笔记", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建 Markdown 笔记" });
  await create.getByLabel("标题", { exact: true }).fill(marker);
  await create.getByRole("button", { name: "创建笔记" }).click();
  await expect(create).toHaveCount(0);
  const body = page.getByRole("textbox", { name: "Markdown 正文" });
  await body.fill(bodyText);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("records-save-status")).toHaveText("已保存");
  await sync();

  const inspector = page.getByTestId("records-inspector");
  await expect(inspector.getByText("由此创建", { exact: true })).toBeVisible();
  const start = bodyText.indexOf(excerpt);
  await body.focus();
  // The excerpt is a whole line: place the caret, then select it by keyboard.
  await body.evaluate(
    (element: HTMLTextAreaElement, offset) =>
      element.setSelectionRange(offset, offset),
    start,
  );
  await body.press("Shift+End");
  const selectButton = page.getByRole("button", { name: "选段用于复习" });
  await expect(selectButton).toBeEnabled();
  await selectButton.click();
  const sheet = page.getByRole("dialog", { name: "将笔记选段用于复习" });
  await expect(sheet.getByLabel("所选原文")).toHaveValue(excerpt);
  await sheet.getByLabel("知识点标题").fill(marker);
  await sheet.getByRole("button", { name: "创建知识点", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("知识点已创建并同步，可前往复习页查看。", { exact: true }),
  ).toBeVisible();

  // The note lists what it produced; the link opens Review on that topic.
  const derived = inspector.getByRole("link", { name: marker, exact: true });
  await expect(derived).toBeVisible();
  await derived.click();
  await waitForWorkbenchReady(page, "/app/review");
  const reviewInspector = page.getByTestId("review-inspector");
  await expect(
    reviewInspector.getByRole("heading", { name: marker, exact: true }),
  ).toBeVisible();
  await expect(reviewInspector.getByText("来源有效")).toBeVisible();
  await expect(
    reviewInspector.getByText(`知识点来自《${marker}》`),
  ).toBeVisible();

  // Only identifiers travel in the URL; Records locates the excerpt text.
  const open = reviewInspector.getByRole("link", { name: "打开原文" });
  const href = await open.getAttribute("href");
  expect(href).not.toContain(encodeURIComponent(excerpt.slice(0, 12)));
  await open.click();
  await waitForWorkbenchReady(page, "/app/records");
  await expect(
    page.getByText("已定位到来源选段。", { exact: true }),
  ).toBeVisible();
  await expect(body).toBeFocused();
  expect(
    await body.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe(excerpt);

  // Rewriting the note turns the source into "modified".
  await body.fill("The note was rewritten without the original sentence.");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByTestId("records-save-status")).toHaveText("已保存");
  await sync();
  await page.getByRole("link", { name: "前往复习", exact: true }).click();
  await waitForWorkbenchReady(page, "/app/review");
  await expect(
    reviewInspector.getByRole("heading", { name: marker, exact: true }),
  ).toBeVisible();
  await expect(reviewInspector.getByText("来源已修改")).toBeVisible();
});
