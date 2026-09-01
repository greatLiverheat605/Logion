import AxeBuilder from "@axe-core/playwright";

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
