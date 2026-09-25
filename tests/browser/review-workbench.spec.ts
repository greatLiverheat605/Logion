import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { components } from "@logion/contracts";

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
type Schemas = components["schemas"];

for (const width of [320, 1440]) {
  test(`Review shows only the selected panel at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    await page.goto("/app/review");
    if (width === 320) {
      await page
        .getByRole("button", { name: "复习工作面", exact: true })
        .click();
    }
    const tabs = page.getByTestId("review-tabs");
    for (const name of ["到期复习", "掌握与图谱", "错因模式", "周期审查"]) {
      await tabs.getByRole("tab", { name: new RegExp(name) }).click();
      await expect(tabs.getByRole("tabpanel")).toHaveCount(1);
      await expect(tabs.getByRole("tabpanel")).toHaveAccessibleName(
        new RegExp(name),
      );
      await expect(tabs.getByRole("tabpanel")).toBeVisible();
      // Keep inactive forms mounted while excluding them from layout and focus.
      await expect(
        tabs.getByRole("tabpanel", { includeHidden: true }),
      ).toHaveCount(4);
    }
  });
}

test("Review restores its tab after a reload in the same browser tab", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/review");
  const cycleTab = page
    .getByTestId("review-tabs")
    .getByRole("tab", { name: /周期审查/ });
  await cycleTab.click();
  await expect(cycleTab).toHaveAttribute("aria-selected", "true");
  await page.reload();
  await expect(cycleTab).toHaveAttribute("aria-selected", "true");
  const stored = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem("logion:workbench-context:review") ?? "{}",
    ),
  );
  expect(Object.keys(stored).sort()).toEqual([
    "selectedId",
    "spaceId",
    "view",
    "workspaceId",
  ]);
  expect(stored.view).toBe("reviews");
});

test("Review exposes the due queue, answer sheet and knowledge inspector", async ({
  page,
  accountState,
}) => {
  test.setTimeout(300_000);
  const manifest = loadGlmTargetManifest();
  const runtimeProblems: string[] = [];
  page.on("console", (entry) => {
    if (entry.text() === "Service Worker registration blocked by Playwright") {
      return;
    }
    if (entry.type() === "error" || entry.type() === "warning") {
      runtimeProblems.push(`${entry.type()}: ${entry.text()}`);
    }
  });
  page.on("pageerror", (error) => runtimeProblems.push(error.message));

  async function readJson<T>(url: string): Promise<T> {
    const response = await page.request.get(url);
    expect(response.status(), url).toBe(200);
    return response.json() as Promise<T>;
  }
  const origin = new URL(page.url()).origin;
  await page.goto("about:blank");
  const login = await page.request.post("/api/v1/auth/login", {
    headers: { Origin: origin },
    data: {
      email: accountState.email,
      password: accountState.password,
      device_name: "Review M08 browser",
    },
  });
  expect(login.status()).toBe(200);
  accountState.authenticatedAt = Date.now();
  const workspaces =
    await readJson<Schemas["WorkspaceListResponse"]>("/api/v1/workspaces");
  const workspaceId = workspaces.workspaces[0]!.id;
  const csrf = (await page.context().cookies(origin)).find(
    (cookie) => cookie.name === "logion_csrf",
  )?.value;
  expect(csrf).toBeTruthy();
  const spaceResponse = await page.request.post(
    `/api/v1/workspaces/${workspaceId}/spaces`,
    {
      headers: { Origin: origin, "X-CSRF-Token": csrf! },
      data: { name: `Review M08 ${randomUUID()}`, visibility: "private" },
    },
  );
  expect(spaceResponse.status()).toBe(201);
  const space = (await spaceResponse.json()) as Schemas["SpaceResponse"];
  const api = `/api/v1/workspaces/${workspaceId}/spaces/${space.id}`;
  // Keep the calendar anchor stable across midnight without pausing timers.
  await page.clock.setFixedTime(new Date());
  await page.goto(`/app/review?workspace=${workspaceId}&space=${space.id}`, {
    waitUntil: "domcontentloaded",
  });
  const reviewReferenceTime = await page.evaluate(() => Date.now());
  await waitForWorkbenchReady(page, "/app/review");
  await expect(
    page.getByRole("heading", { name: "把“看过”变成真正能回忆" }),
  ).toBeVisible();
  await expect(page.getByTestId("review-due-queue")).toBeAttached();
  await expect(page.getByTestId("review-answer")).toBeAttached();
  await expect(page.getByTestId("review-inspector")).toBeAttached();
  await expect(page.getByTestId("review-misconceptions")).toBeAttached();
  await expect(page.getByTestId("review-cycle")).toBeAttached();

  const unlockTrigger = page.locator("#review-unlock");
  if (await unlockTrigger.isVisible()) {
    await unlockTrigger.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地复习资料" });
    await expect(sheet.getByLabel("本地口令")).toBeFocused();
    await sheet.getByLabel("本地口令").fill("review-e2e-passphrase");
    await sheet.getByRole("button", { name: "解锁本地资料" }).click();
    await expect(sheet).toHaveCount(0);
  }

  const topicTitle = `Review E2E ${Date.now()}`;
  await page.getByRole("button", { exact: true, name: "新建知识点" }).click();
  const topicSheet = page.getByRole("dialog", { name: "新建知识点" });
  await topicSheet.getByLabel("名称").fill(topicTitle);
  await topicSheet.getByLabel("说明").fill("用于真实 Review 复习闭环验收。");
  await topicSheet.getByRole("button", { name: "保存知识点" }).click();
  await expect(topicSheet).toHaveCount(0);
  const topicButton = page.getByRole("button", {
    name: new RegExp(topicTitle),
  });
  await expect(topicButton).toBeVisible();
  await topicButton.click();

  await page.getByRole("tab", { name: /掌握与图谱/ }).click();
  await expect(page.getByRole("button", { name: "图谱" })).toBeVisible();
  await page.getByRole("button", { name: "列表与掌握确认" }).click();
  await expect(
    page.getByRole("heading", { name: /掌握与先修关系/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "新建主动回忆题" }).click();
  const quizSheet = page.getByRole("dialog", { name: "新建主动回忆题" });
  await quizSheet
    .getByLabel("题目")
    .fill("请说明这个知识点在真实任务中的关键判断。");
  await quizSheet.getByLabel("参考答案").fill("先明确约束，再验证证据。");
  await quizSheet.getByLabel("判定方式").selectOption("exact_match");
  await quizSheet.getByLabel("解析（可选）").fill("答案应体现约束与证据意识。");
  await quizSheet.getByRole("button", { name: "加密保存题目" }).click();
  await expect(quizSheet).toHaveCount(0);

  await page.getByRole("tab", { name: "到期复习" }).click();
  const startRecall = page.getByTestId("review-answer").getByRole("button", {
    exact: true,
    name: "开始回忆",
  });
  await expect(startRecall).toBeVisible();
  await startRecall.click();
  const answerSheet = page.getByRole("dialog", { name: "主动回忆" });
  await answerSheet.getByLabel("我的答案").fill("先明确约束，再验证证据。");
  await answerSheet.getByRole("button", { name: "提交回答" }).click();
  await answerSheet.getByLabel("信心（1-5）").fill("4");
  await answerSheet.getByLabel("用时（秒）").fill("12");
  await answerSheet.getByLabel("若错误，主要原因").selectOption("unknown");
  await answerSheet.getByRole("button", { name: "保存答题记录" }).click();
  await expect(answerSheet).toHaveCount(0);

  await startRecall.click();
  await expect(answerSheet.getByLabel("我的答案")).toHaveValue("");
  await expect(
    answerSheet.getByRole("button", { name: "提交回答" }),
  ).toBeVisible();
  await expect(answerSheet.getByLabel("信心（1-5）")).toHaveCount(0);
  await answerSheet.getByLabel("我的答案").fill("第二次回答");
  await answerSheet.getByRole("button", { name: "提交回答" }).click();
  await page.keyboard.press("Escape");
  await expect(answerSheet).toHaveCount(0);
  await startRecall.click();
  await expect(answerSheet.getByLabel("我的答案")).toHaveValue("");
  await answerSheet.getByLabel("我的答案").fill("取消的草稿");
  await answerSheet.getByRole("button", { name: "取消" }).click();
  await expect(answerSheet).toHaveCount(0);
  await startRecall.click();
  await expect(answerSheet.getByLabel("我的答案")).toHaveValue("");
  await expect(
    answerSheet.getByRole("button", { name: "提交回答" }),
  ).toBeVisible();
  await answerSheet.getByRole("button", { name: "取消" }).click();
  await expect(answerSheet).toHaveCount(0);

  const topics = await readJson<Schemas["TopicListResponse"]>(`${api}/topics`);
  expect(topics.topics).toHaveLength(1);
  const topic = topics.topics[0]!;
  expect(topic.title).toBe(topicTitle);
  expect(topic.space_id).toBe(space.id);
  const quizzes = await readJson<Schemas["QuizItemListResponse"]>(
    `${api}/quiz-items`,
  );
  expect(quizzes.quiz_items).toHaveLength(1);
  const quiz = quizzes.quiz_items[0]!;
  expect(quiz.topic_id).toBe(topic.id);
  expect(quiz.evaluation_mode).toBe("exact_match");
  const getPatterns = async () =>
    (
      await readJson<Schemas["ErrorPatternListResponse"]>(
        `${api}/error-patterns`,
      )
    ).error_patterns;
  for (const index of [1, 2]) {
    await startRecall.click();
    await answerSheet.getByLabel("我的答案").fill(`M08 错误回答 ${index}`);
    await answerSheet.getByRole("button", { name: "提交回答" }).click();
    await answerSheet.getByLabel("信心（1-5）").fill("2");
    await answerSheet.getByLabel("用时（秒）").fill("17");
    await answerSheet.getByLabel("若错误，主要原因").selectOption("recall_gap");
    await answerSheet.getByRole("button", { name: "保存答题记录" }).click();
    await expect(answerSheet).toHaveCount(0);
    await expect.poll(getPatterns).toMatchObject([
      {
        topic_id: topic.id,
        cause: "recall_gap",
        occurrence_count: index,
        status: "open",
      },
    ]);
  }
  const attempts = (
    await readJson<Schemas["QuizAttemptListResponse"]>(`${api}/quiz-attempts`)
  ).attempts;
  expect(attempts).toHaveLength(3);
  expect(attempts.filter((item) => item.is_correct)).toHaveLength(1);
  for (const index of [1, 2]) {
    expect(
      attempts.find((item) => item.response_text === `M08 错误回答 ${index}`),
    ).toMatchObject({
      quiz_item_id: quiz.id,
      topic_id: topic.id,
      is_correct: false,
      confidence: 2,
      duration_seconds: 17,
      error_cause: "recall_gap",
    });
  }
  const pattern = (await getPatterns())[0]!;
  expect(pattern.latest_attempt_id).toBe(
    attempts.find((item) => item.response_text === "M08 错误回答 2")!.id,
  );
  async function assertForecast() {
    const result = await readJson<Schemas["TopicListResponse"]>(
      `${api}/topics`,
    );
    const schedules = result.topics.flatMap((item) =>
      item.review_schedule ? [item.review_schedule] : [],
    );
    expect(schedules).toHaveLength(1);
    const expected = await page.evaluate(
      ({ schedules, anchor }) => {
        const start = new Date(anchor);
        start.setHours(0, 0, 0, 0);
        return Array.from({ length: 7 }, (_, index) => {
          const left = new Date(start);
          left.setDate(left.getDate() + index);
          const right = new Date(left);
          right.setDate(right.getDate() + 1);
          return schedules.filter((item) => {
            if (["completed", "skipped"].includes(item.status)) return false;
            const due = Date.parse(item.next_review_at);
            return (
              due < right.getTime() && (index === 0 || due >= left.getTime())
            );
          }).length;
        });
      },
      { schedules, anchor: reviewReferenceTime },
    );
    const chart = page.locator('[aria-label="未来七天复习数量"]');
    await expect(chart.locator(":scope > div > small")).toHaveText([
      "今天",
      "+1 天",
      "+2 天",
      "+3 天",
      "+4 天",
      "+5 天",
      "+6 天",
    ]);
    await expect
      .poll(() => chart.locator(":scope > div > strong").allTextContents())
      .toEqual(expected.map(String));
    return expected;
  }
  const dueTopic = (
    await readJson<Schemas["TopicListResponse"]>(`${api}/topics`)
  ).topics[0]!;
  expect(dueTopic.review_schedule).toMatchObject({
    topic_id: topic.id,
    source: "quiz_error",
    status: "due",
    interval_days: 1,
  });
  expect((await assertForecast()).reduce((sum, value) => sum + value, 0)).toBe(
    1,
  );
  await page.getByRole("tab", { name: /错因模式/ }).click();
  const patternRow = page
    .getByTestId("review-misconceptions")
    .locator("article");
  await expect(patternRow).toHaveCount(1);
  await expect(patternRow).toContainText("recall_gap");
  await expect(patternRow).toContainText("2 次");
  const resolvePattern = patternRow.getByRole("button", { name: "标记解决" });
  await expect(resolvePattern).toBeEnabled();
  await resolvePattern.click();
  await expect.poll(getPatterns).toMatchObject([
    {
      id: pattern.id,
      occurrence_count: 2,
      status: "resolved",
    },
  ]);
  await expect(patternRow.getByText("已解决", { exact: true })).toBeVisible();
  await expect(resolvePattern).toHaveCount(0);
  await page.getByRole("tab", { name: /掌握与图谱/ }).click();
  await page.getByRole("button", { name: "列表与掌握确认" }).click();
  const masterySelect = page.getByLabel(`${topicTitle} 的掌握确认`, {
    exact: true,
  });
  await masterySelect.selectOption("practicing");
  await page
    .locator("article")
    .filter({ has: masterySelect })
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await readJson<Schemas["TopicListResponse"]>(`${api}/topics`))
          .topics[0]?.review_schedule,
    )
    .toMatchObject({
      id: dueTopic.review_schedule!.id,
      source: "mastery_confirmation",
      status: "scheduled",
      interval_days: 2,
    });
  await page.getByRole("tab", { name: "到期复习" }).click();
  const future = await assertForecast();
  expect(future[0]).toBe(0);
  expect(future.reduce((sum, value) => sum + value, 0)).toBe(1);
  const summary = `${topicTitle} 周期审查`;
  const findingText = `${topicTitle} 记忆缺口`;
  const nextAction = "再次主动回忆并核对证据";
  const getReview = async () =>
    (
      await readJson<Schemas["AuditReviewListResponse"]>(`${api}/audit-reviews`)
    ).reviews.find((item) => item.summary === summary);
  await page.getByRole("tab", { name: /周期审查/ }).click();
  await page.getByRole("button", { name: "创建审查", exact: true }).click();
  const reviewSheet = page.getByRole("dialog", { name: "创建周期审查" });
  await reviewSheet.getByLabel("周期", { exact: true }).selectOption("daily");
  await reviewSheet.getByLabel("开始日期").fill("2027-01-05");
  await reviewSheet.getByLabel("结束日期").fill("2027-01-05");
  await reviewSheet.getByLabel("总结草稿").fill(summary);
  await reviewSheet.getByRole("button", { name: "保存审查草稿" }).click();
  await expect(reviewSheet).toHaveCount(0);
  await expect.poll(getReview).toMatchObject({
    cadence: "daily",
    period_start: "2027-01-05",
    period_end: "2027-01-05",
    status: "draft",
    completed_at: null,
    findings: [],
  });
  const reviewId = (await getReview())!.id;
  const reviewRow = page
    .getByTestId("review-cycle")
    .locator("article")
    .filter({ hasText: summary });
  await expect(reviewRow).toHaveCount(1);
  await reviewRow.getByLabel("发现类型").selectOption("error_pattern");
  await reviewRow.getByLabel("发现", { exact: true }).fill(findingText);
  await reviewRow.getByLabel("下一步", { exact: true }).fill(nextAction);
  await reviewRow.getByRole("button", { name: "添加发现" }).click();
  await expect.poll(getReview).toMatchObject({
    id: reviewId,
    status: "draft",
    findings: [
      {
        audit_review_id: reviewId,
        category: "error_pattern",
        description: findingText,
        suggested_action: nextAction,
        status: "open",
      },
    ],
  });
  const findingId = (await getReview())!.findings[0]!.id;
  await reviewRow.getByRole("button", { name: "解决", exact: true }).click();
  await expect.poll(getReview).toMatchObject({
    id: reviewId,
    status: "draft",
    findings: [{ id: findingId, status: "resolved" }],
  });
  await expect(reviewRow.getByText("已解决", { exact: true })).toBeVisible();
  await reviewRow.getByRole("button", { name: "明确完成" }).click();
  await expect.poll(getReview).toMatchObject({
    id: reviewId,
    status: "completed",
    findings: [{ id: findingId, status: "resolved" }],
  });
  expect(Number.isFinite(Date.parse((await getReview())!.completed_at!))).toBe(
    true,
  );
  await expect(reviewRow.getByText("已完成", { exact: true })).toBeVisible();
  await expect(reviewRow.getByRole("button", { name: "添加发现" })).toHaveCount(
    0,
  );
  await expect(reviewRow.getByRole("button", { name: "明确完成" })).toHaveCount(
    0,
  );
  await page.getByRole("tab", { name: "到期复习" }).click();

  await page.reload();
  await page.locator("#review-unlock").click();
  const reopenVault = page.getByRole("dialog", { name: "解锁本地复习资料" });
  await reopenVault.getByLabel("本地口令").fill("review-e2e-passphrase");
  await reopenVault.getByRole("button", { name: "解锁本地资料" }).click();
  await expect(reopenVault).toHaveCount(0);
  await topicButton.click();
  await page.getByRole("tab", { name: /错因模式/ }).click();
  await expect(patternRow.getByText("已解决", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /周期审查/ }).click();
  await expect(reviewRow.getByText("已完成", { exact: true })).toBeVisible();
  await expect(reviewRow.getByText("已解决", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "到期复习" }).click();
  expect(await assertForecast()).toEqual(future);

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await waitForWorkbenchReady(page, "/app/review");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document
        .querySelectorAll<HTMLElement>(
          ".app-content, .app-nav-scroll, .workbench-master, .workbench-main, .workbench-inspector",
        )
        .forEach((element) => element.scrollTo(0, 0));
    });
    await assertNoHorizontalOverflow(page, "/app/review", viewport);
    await assertGlmRouteRegions(page, manifest, "/app/review");
    await assertGlmShellGeometry(page, manifest);
    await assertGlmWorkbenchGeometry(page, manifest);
    await assertGlmPrimaryContract(page, manifest, "/app/review");
    const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
    expect(axe.violations, `Review ${viewport.label} Axe`).toEqual([]);
    await captureEvidenceScreenshot(page, "after", "/app/review", viewport);
    await assertPrimaryActionContract(page, "/app/review", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertReducedMotion(page, "/app/review", viewport);
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(runtimeProblems).toEqual([]);
});
