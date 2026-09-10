import AxeBuilder from "@axe-core/playwright";
import { createHash, randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

async function setTheme(page: Page, theme: "light" | "dark") {
  await expect(page.locator(".app-shell-frame")).toBeVisible();
  const toggle = page.getByRole("button", {
    name: theme === "dark" ? "切换到深色主题" : "切换到浅色主题",
    exact: true,
  });
  if (await toggle.count()) await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

for (const theme of ["light", "dark"] as const) {
  test(`success feedback has readable contrast in ${theme} theme`, async ({
    page,
    accountState,
  }, testInfo) => {
    await page.goto("/app/sync");
    await page
      .getByLabel("本地解锁口令", { exact: true })
      .fill(accountState.password);
    await page.getByRole("button", { name: "解锁资料", exact: true }).click();
    await expect(page.getByLabel("本地解锁口令", { exact: true })).toHaveCount(
      0,
    );
    await setTheme(page, theme);

    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
      await page.getByRole("button", { name: "立即同步", exact: true }).click();
      const toast = page.locator('[data-sonner-toast][data-type="success"]');
      await expect(toast).toContainText("同步完成");
      await expect(toast).toHaveCSS("opacity", "1");
      await toast.hover();
      await expect(toast).toBeInViewport({ ratio: 1 });
      const axe = await new AxeBuilder({ page })
        .include("[data-sonner-toaster]")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(axe.violations, `${theme} success toast at ${width}px`).toEqual(
        [],
      );
      await page.screenshot({
        path: testInfo.outputPath(`success-${theme}-${width}.png`),
      });
      await expect(toast).toBeVisible();
      await toast.getByRole("button", { name: "关闭反馈" }).click();
      await expect(toast).toHaveCount(0);
    }
  });
}

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

async function visibleFeedback(page: Page, code: string, type = "error") {
  const toast = page
    .locator(`[data-sonner-toast][data-type="${type}"]`)
    .filter({ hasText: code })
    .first();
  await expect(toast).toBeInViewport({ ratio: 1 });
  await expect(toast).toHaveCSS("opacity", "1");
  await toast.hover();
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
    for (const failure of [true, false]) {
      test(`feedback ${module} ${failure ? "HTTP 503" : "real success"} remains visible at ${width}px`, async ({
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
        await setTheme(page, "light");
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
          await page
            .getByLabel("想法或资料标题")
            .fill(`Feedback ${Date.now()}`);
        } else if (module === "exam") {
          await page.getByTestId("exam-create").click();
          await page.getByLabel("考试名称").fill(`Feedback ${Date.now()}`);
          await page.getByLabel("日期待定").check();
        } else {
          await page.getByRole("tab", { name: /周期审查/ }).click();
          await page
            .getByRole("button", { name: "创建审查", exact: true })
            .click();
          const day = new Date(Date.UTC(failure ? 2040 : 2045, 0, width))
            .toISOString()
            .slice(0, 10);
          await page.getByLabel("开始日期").fill(day);
          await page.getByLabel("结束日期").fill(day);
        }
        if (failure) {
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
        }
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
        const success =
          module === "review"
            ? "审查数据已同步。"
            : module === "exam"
              ? "备考数据已同步。"
              : "自主学习资料已同步。";
        const toast = await visibleFeedback(
          page,
          failure ? "T03_SYNC_UNAVAILABLE" : success,
          failure ? "error" : "success",
        );
        await expect(
          page
            .locator('[class*="statusLine"]')
            .filter({ hasText: failure ? "T03_SYNC_UNAVAILABLE" : success })
            .first(),
        ).toBeAttached();
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
          page.locator(
            `[data-sonner-toast][data-type="${failure ? "success" : "error"}"]`,
          ),
        ).toHaveCount(0);
        if (failure && module === "self-study") {
          await expect(page.locator('[class*="statusLine"]')).not.toContainText(
            "已加密保存",
          );
        }
        await page.screenshot({
          path: testInfo.outputPath(
            `${module}-${width}-${failure ? "failure" : "success"}.png`,
          ),
        });
        await expect(toast).toBeVisible();
        expect(cspErrors).toEqual([]);
      });
    }
  }

  for (const failure of [true, false]) {
    test(`feedback attachment ${failure ? "failure exposes the precise code" : "mock verified success"} at ${width}px`, async ({
      page,
      accountState,
    }, testInfo) => {
      await page.setViewportSize({
        width,
        height: width === 320 ? 568 : width === 375 ? 812 : 1000,
      });
      await page.goto("/app/records");
      await setTheme(page, "light");
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
        await page
          .getByRole("button", { name: "解锁资料", exact: true })
          .click();
        await expect(password).toHaveCount(0);
      }
      await page.getByRole("tab", { name: /附件队列/ }).click();
      const uploadSteps: string[] = [];
      if (failure) {
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
      } else {
        // Transport contract only: no ingest or scanner is enabled by this fixture.
        let attachmentPath: string | undefined;
        const bytes = Buffer.from("Synthetic feedback test", "utf8");
        await page.route("**/attachments/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          const step = path.split("/").at(-1)!;
          uploadSteps.push(step);
          expect(route.request().method()).toBe(
            step === "content" ? "PUT" : "POST",
          );
          if (step === "init") {
            const payload = route.request().postDataJSON();
            expect(payload).toMatchObject({
              filename: "feedback.txt",
              declared_mime: "text/plain",
              size_bytes: bytes.length,
              sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            });
            expect(payload.id).toMatch(/^[a-f0-9-]{36}$/);
            attachmentPath = `${path.slice(0, -5)}/${payload.id}`;
          } else {
            expect(attachmentPath).toBeDefined();
            expect(path).toBe(`${attachmentPath}/${step}`);
            if (step === "content")
              expect(route.request().postDataBuffer()).toEqual(bytes);
            else
              expect(route.request().postDataJSON()).toEqual({
                expected_version: 2,
              });
          }
          const states: Record<string, { status: string; version: number }> = {
            init: { status: "pending", version: 1 },
            content: { status: "uploaded", version: 2 },
            complete: { status: "verified", version: 3 },
          };
          expect(states[step]).toBeDefined();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            json: states[step],
          });
        });
      }
      await page
        .getByRole("button", { name: "上传并验证", exact: true })
        .first()
        .click();
      const toast = await visibleFeedback(
        page,
        failure
          ? "KNOWLEDGE_ATTACHMENT_INGEST_DISABLED"
          : "附件「feedback.txt」上传成功，并完成服务器哈希验证。",
        failure ? "error" : "success",
      );
      if (failure) {
        await actionNotCovered(
          page.getByRole("button", { name: "重试", exact: true }).first(),
          toast,
        );
        await expect(page.locator("body")).not.toContainText(
          "完成服务器哈希验证",
        );
      } else {
        expect(uploadSteps).toEqual(["init", "content", "complete"]);
        await expect(page.getByTestId("sync-inspector")).toContainText(
          "附件「feedback.txt」上传成功，并完成服务器哈希验证。",
        );
        await expect(
          page.locator('[data-sonner-toast][data-type="error"]'),
        ).toHaveCount(0);
      }
      await page.screenshot({
        path: testInfo.outputPath(
          `attachment-${width}-${failure ? "failure" : "success"}.png`,
        ),
      });
    });
  }
}

for (const width of [1440, 320]) {
  for (const theme of ["light", "dark"] as const) {
    for (const module of ["provider", "run", "persona"] as const) {
      for (const failure of [false, true]) {
        test(`feedback ${module} ${failure ? "failure" : "success"} contract at ${width}px in ${theme}`, async ({
          page,
        }, testInfo) => {
          await page.setViewportSize({
            width,
            height: width === 320 ? 568 : 1000,
          });
          const code =
            module === "provider"
              ? "AI_PROVIDER_DNS_UNRESOLVABLE"
              : `M5_${module.toUpperCase()}_UNAVAILABLE`;
          const requestId = `m5-feedback-${module}`;
          const error = {
            code,
            message: "Synthetic feedback boundary",
            request_id: requestId,
            retryable: true,
          };
          const cspErrors: string[] = [];
          page.on("pageerror", (error) => cspErrors.push(error.name));
          page.on("console", (entry) => {
            if (/content security policy|violat/i.test(entry.text()))
              cspErrors.push(entry.text());
          });
          let writes = 0;
          let previewed = 0;
          let success: string;
          let region: Locator;
          const readPersona = async () => {
            const response = await page.request.get(
              "/api/v1/users/me/settings",
            );
            expect(response.status()).toBe(200);
            return (
              (await response.json()) as {
                settings: Array<{
                  key: string;
                  value: string;
                  version: number;
                }>;
              }
            ).settings.find((item) => item.key === "persona")!;
          };
          let initialPersona:
            | Awaited<ReturnType<typeof readPersona>>
            | undefined;
          if (module === "persona") {
            await page.goto("/app/settings");
            await setTheme(page, theme);
            region = page.getByTestId("workbench-frame");
            initialPersona = await readPersona();
            expect(JSON.parse(initialPersona.value).activePersonaId).toBe(
              "self",
            );
            await page.route("**/api/v1/users/me/settings", async (route) => {
              if (route.request().method() !== "PUT") return route.fallback();
              writes++;
              const setting = route
                .request()
                .postDataJSON()
                .settings.find(
                  (item: { key: string }) => item.key === "persona",
                );
              expect(JSON.parse(setting.value).activePersonaId).toBe("exam");
              if (failure) await route.fulfill({ status: 503, json: error });
              else {
                const response = await route.fetch();
                expect(response.status()).toBe(200);
                await route.fulfill({ response });
              }
            });
            await page.getByRole("button", { name: /^切换到：考，/ }).click();
            success = "已切换到「考」画像。";
          } else {
            const providerId = randomUUID();
            let run: Record<string, unknown> | null = null;
            // All AI requests terminate here, including submission and discovery.
            await page.route("**/api/v1/workspaces/*/ai/**", async (route) => {
              const path = new URL(route.request().url()).pathname;
              const method = route.request().method();
              if (
                path.endsWith("/discover-models") ||
                (path.endsWith("/runs") && method === "POST")
              ) {
                writes++;
                if (module === "run") {
                  const payload = route.request().postDataJSON();
                  expect(payload.send_confirmed).toBe(true);
                  expect(payload.input_fields).toEqual({
                    body: "Synthetic feedback input",
                  });
                  run = {
                    ...payload,
                    status: "queued",
                    attempt_count: 0,
                    reserved_tokens: 12,
                    version: 1,
                  };
                }
                await route.fulfill({
                  status: failure ? 503 : module === "run" ? 202 : 200,
                  json: failure
                    ? error
                    : module === "run"
                      ? run
                      : { model_count: 2 },
                });
                return;
              }
              if (path.endsWith("/route-resolution-preview")) {
                previewed++;
                await route.fulfill({
                  json: {
                    candidates: [
                      {
                        provider_id: providerId,
                        model_id: "synthetic-model",
                        estimated_tokens: 12,
                        estimated_cost_minor: 0,
                      },
                    ],
                    monthly_token_budget: null,
                    monthly_cost_budget_minor: null,
                    currency: "USD",
                  },
                });
                return;
              }
              const collections: Record<string, unknown> = {
                providers: {
                  providers: [
                    {
                      id: providerId,
                      name: "Synthetic Provider",
                      enabled: true,
                      credential_configured: true,
                      health_status: "healthy",
                      version: 1,
                    },
                  ],
                },
                models: { models: [] },
                routes: { routes: [] },
                budget: { monthly_token_budget: null },
                runs: { runs: run && !failure ? [run] : [] },
                drafts: { drafts: [] },
              };
              const body = collections[path.split("/").at(-1)!];
              expect(method).toBe("GET");
              expect(body).toBeDefined();
              await route.fulfill({ json: body });
            });
            await page.goto("/app/ai");
            await setTheme(page, theme);
            if (module === "provider") {
              await page
                .getByTestId("ai-mode")
                .getByRole("tab", { name: "Provider", exact: true })
                .click();
              region = page.getByTestId("ai-provider");
              const discover = region.getByRole("button", {
                name: "测试并发现模型",
                exact: true,
              });
              page.once("dialog", (dialog) => dialog.dismiss());
              await discover.click();
              expect(writes).toBe(0);
              page.once("dialog", (dialog) => dialog.accept());
              await discover.click();
              success = "连接检查成功，发现 2 个模型。";
            } else {
              region = page.locator("#ai-run-center");
              if (width === 320)
                await region
                  .getByRole("button", { name: "运行与草稿目录", exact: true })
                  .click();
              await page
                .getByRole("button", { name: "创建结构化草稿", exact: true })
                .click();
              const sheet = page.getByRole("dialog", {
                name: "创建结构化草稿",
              });
              for (const [label, value] of Object.entries({
                任务类型: "summarize",
                目标类型: "note",
                "目标 ID": randomUUID(),
                发送字段名: "body",
                草稿输出字段: "summary",
                发送内容: "Synthetic feedback input",
              })) {
                await sheet.getByLabel(label, { exact: true }).fill(value);
              }
              await sheet
                .getByLabel("我已明确选择并核对上述发送来源与内容范围")
                .check();
              await sheet
                .getByRole("button", { name: "预检发送范围与预算" })
                .click();
              await expect(sheet).toHaveCount(0);
              const preflight = page.locator(
                '[data-sonner-toast][data-type="success"]',
              );
              await expect(preflight).toContainText("预检完成");
              await preflight.getByRole("button", { name: "关闭反馈" }).click();
              await expect(preflight).toHaveCount(0);
              expect(writes).toBe(0);
              if (width === 320)
                await region
                  .getByRole("button", { name: "草稿审查", exact: true })
                  .click();
              await page
                .getByLabel(
                  "我确认上述数据范围、Provider、模型与预算信息，可以发送",
                )
                .check();
              await page
                .getByRole("button", {
                  name: "确认并发送到 Provider",
                  exact: true,
                })
                .click();
              success = "AI 运行已入队；可随时刷新状态或请求取消。";
            }
          }
          const toast = await visibleFeedback(
            page,
            failure ? code : success,
            failure ? "error" : "success",
          );
          expect(writes).toBe(1);
          if (module === "run") expect(previewed).toBe(1);
          if (module === "persona") {
            const saved = await readPersona();
            if (failure) expect(saved).toEqual(initialPersona);
            else {
              expect(JSON.parse(saved.value).activePersonaId).toBe("exam");
              expect(saved.version).toBe(initialPersona!.version + 1);
            }
            await expect(
              page.getByRole("button", { name: /^切换到：考，/ }),
            ).toHaveAttribute("aria-pressed", String(!failure));
            await expect(
              page.getByRole("button", { name: /^切换到：学，/ }),
            ).toHaveAttribute("aria-pressed", String(failure));
          }
          await expect(
            region
              .locator('[aria-live="polite"]')
              .filter({ hasText: failure ? code : success })
              .first(),
          ).toBeAttached();
          await expect(
            page.locator(
              `[data-sonner-toast][data-type="${failure ? "success" : "error"}"]`,
            ),
          ).toHaveCount(0);
          if (failure) {
            await expect(toast).toContainText(requestId);
            await expect(region).not.toContainText(success);
          }
          const axe = await new AxeBuilder({ page })
            .include("[data-sonner-toaster]")
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          expect(axe.violations).toEqual([]);
          await page.screenshot({
            path: testInfo.outputPath(
              `${module}-${width}-${failure ? "failure" : "success"}.png`,
            ),
          });
          expect(cspErrors).toEqual([]);
        });
      }
    }
  }
}
