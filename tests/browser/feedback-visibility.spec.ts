import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function unlock(page: Page, passphrase: string) {
  const button = page
    .getByRole("button", { name: "解锁资料", exact: true })
    .first();
  await expect(button).toBeVisible();
  {
    await button.click();
    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("本地口令", { exact: true }).fill(passphrase);
    await sheet.getByRole("button", { name: "解锁资料", exact: true }).click();
    await expect(sheet).toHaveCount(0);
  }
}

async function visibleFailure(page: Page, code: string) {
  const toast = page
    .locator('[data-sonner-toast][data-type="error"]')
    .filter({ hasText: code })
    .first();
  await expect(toast).toBeInViewport({ ratio: 1 });
  await expect(toast).toHaveCSS("opacity", "1");
  const live = page
    .locator('section[aria-live="polite"]')
    .filter({ has: toast });
  await expect(live).not.toHaveAttribute("aria-hidden", "true");
  await expect(toast.getByRole("button", { name: "关闭反馈" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const title = toast.locator("[data-title]");
  await expect(title).toBeInViewport({ ratio: 1 });
  expect(
    await title.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return hit !== null && (node.contains(hit) || hit.contains(node));
    }),
  ).toBe(true);
  return toast;
}

async function actionNotCovered(action: Locator, toast: Locator) {
  const actionBox = await action.boundingBox();
  const toastBox = await toast.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(toastBox).not.toBeNull();
  expect(
    actionBox!.x < toastBox!.x + toastBox!.width &&
      actionBox!.x + actionBox!.width > toastBox!.x &&
      actionBox!.y < toastBox!.y + toastBox!.height &&
      actionBox!.y + actionBox!.height > toastBox!.y,
  ).toBe(false);
}

for (const width of [1440, 375, 320]) {
  for (const module of ["self-study", "exam", "review"] as const) {
    test(`feedback ${module} HTTP 503 remains visible at ${width}px`, async ({
      page,
      accountState,
    }, testInfo) => {
      await page.setViewportSize({
        width,
        height: width === 320 ? 568 : width === 375 ? 812 : 1000,
      });
      const cspErrors: string[] = [];
      page.on("console", (entry) => {
        if (/content security policy|violat/i.test(entry.text()))
          cspErrors.push(entry.text());
      });
      await page.goto(`/app/${module}`);
      await unlock(
        page,
        process.env.LOGION_E2E_VAULT_PASSPHRASE || accountState.password,
      );
      if (width < 720 && module !== "self-study") {
        await page
          .getByRole("button", {
            name: module === "review" ? "复习工作面" : "考试列表",
            exact: true,
          })
          .click();
      }
      if (module === "self-study") {
        await page
          .getByRole("button", { name: "快速收集", exact: true })
          .click();
        await page.getByLabel("想法或资料标题").fill(`Feedback ${Date.now()}`);
      } else if (module === "exam") {
        await page.getByTestId("exam-create").click();
        await page.getByLabel("考试名称").fill(`Feedback ${Date.now()}`);
        await page.getByLabel("日期待定").check();
      } else {
        await page.getByRole("tab", { name: /周期审查/ }).click();
        await page
          .getByRole("button", { name: "创建审查", exact: true })
          .click();
        await page.getByLabel("开始日期").fill("2026-11-01");
        await page.getByLabel("结束日期").fill("2026-11-01");
      }
      await page.route("**/api/v1/workspaces/*/sync/**", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            code: "T03_SYNC_UNAVAILABLE",
            message: "Injected failure",
            request_id: "feedback-test",
            retryable: true,
          }),
        }),
      );
      const sheet = page.getByRole("dialog");
      await sheet
        .getByRole("button", {
          name:
            module === "review"
              ? "保存审查草稿"
              : module === "exam"
                ? "创建考试"
                : "快速收集想法",
          exact: true,
        })
        .click();
      await expect(sheet).toHaveCount(0);
      const toast = await visibleFailure(page, "T03_SYNC_UNAVAILABLE");
      await actionNotCovered(
        module === "exam"
          ? page.getByTestId("exam-create")
          : page.getByRole("button", {
              name: module === "review" ? "创建审查" : "快速收集",
              exact: true,
            }),
        toast,
      );
      await expect(
        page.locator('[data-sonner-toast][data-type="success"]'),
      ).toHaveCount(0);
      if (module === "self-study") {
        await expect(page.locator('[class*="statusLine"]')).not.toContainText(
          "已加密保存",
        );
      }
      await page.screenshot({
        path: testInfo.outputPath(`${module}-${width}.png`),
      });
      await expect(toast).toBeVisible();
      expect(cspErrors).toEqual([]);
    });
  }

  test(`feedback attachment failure exposes the precise code at ${width}px`, async ({
    page,
    accountState,
  }, testInfo) => {
    await page.setViewportSize({
      width,
      height: width === 320 ? 568 : width === 375 ? 812 : 1000,
    });
    await page.goto("/app/records");
    await unlock(
      page,
      process.env.LOGION_E2E_VAULT_PASSPHRASE || accountState.password,
    );
    await page.getByRole("button", { name: "新建笔记", exact: true }).click();
    const note = page.getByRole("dialog", { name: "新建 Markdown 笔记" });
    await note
      .getByLabel("标题", { exact: true })
      .fill(`Feedback attachment ${Date.now()}`);
    await note.getByRole("button", { name: "创建笔记", exact: true }).click();
    await expect(note).toHaveCount(0);
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "添加笔记附件" });
    await sheet.getByLabel("附件", { exact: true }).setInputFiles({
      name: "feedback.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic feedback test", "utf8"),
    });
    await sheet
      .getByRole("button", { name: "加入附件队列", exact: true })
      .click();
    await expect(sheet).toHaveCount(0);
    await page.goto("/app/sync");
    const password = page.getByLabel("本地解锁口令", { exact: true });
    await expect(password).toBeVisible();
    {
      await password.fill(
        process.env.LOGION_E2E_VAULT_PASSPHRASE || accountState.password,
      );
      await page.getByRole("button", { name: "解锁资料", exact: true }).click();
      await expect(password).toHaveCount(0);
    }
    await page.getByRole("tab", { name: /附件队列/ }).click();
    await page.route("**/attachments/init", (route) =>
      route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({
          code: "KNOWLEDGE_ATTACHMENT_INGEST_DISABLED",
          message: "Injected default-off response",
          request_id: "feedback-attachment",
          retryable: false,
        }),
      }),
    );
    await page
      .getByRole("button", { name: "上传并验证", exact: true })
      .first()
      .click();
    const toast = await visibleFailure(
      page,
      "KNOWLEDGE_ATTACHMENT_INGEST_DISABLED",
    );
    await actionNotCovered(
      page.getByRole("button", { name: "重试", exact: true }).first(),
      toast,
    );
    await expect(page.locator("body")).not.toContainText("完成服务器哈希验证");
    await page.screenshot({
      path: testInfo.outputPath(`attachment-${width}.png`),
    });
  });
}
