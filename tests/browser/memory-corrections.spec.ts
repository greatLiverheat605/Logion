import { expect, test } from "./fixtures";
import { waitForWorkbenchReady } from "./workbench-audit";

// ADR-0036: correcting topics, prerequisites and recall items in Review.
test("Review corrects a topic, retires a recall item and removes a prerequisite", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const first = `Correction base ${stamp}`;
  const second = `Correction target ${stamp}`;
  const renamed = `${second} renamed`;
  await page.goto("/app/review");
  await waitForWorkbenchReady(page, "/app/review");
  const unlockTrigger = page.locator("#review-unlock");
  if (await unlockTrigger.isVisible()) {
    await unlockTrigger.click();
    const sheet = page.getByRole("dialog", { name: "解锁本地复习资料" });
    await sheet.getByLabel("本地口令").fill("memory-correction-passphrase");
    await sheet.getByRole("button", { name: "解锁本地资料" }).click();
    await expect(sheet).toHaveCount(0);
  }
  for (const title of [first, second]) {
    await page.getByRole("button", { exact: true, name: "新建知识点" }).click();
    const topicSheet = page.getByRole("dialog", { name: "新建知识点" });
    await topicSheet.getByLabel("名称").fill(title);
    await topicSheet.getByRole("button", { name: "保存知识点" }).click();
    await expect(topicSheet).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: new RegExp(`^${second}`) })
    .first()
    .click();
  const inspector = page.getByTestId("review-inspector");
  await expect(inspector.getByRole("heading", { name: second })).toBeVisible();

  // Edit the topic name.
  await inspector.getByRole("button", { name: "编辑知识点" }).click();
  const editTopic = page.getByRole("dialog", { name: "编辑知识点" });
  await editTopic.getByLabel("名称").fill(renamed);
  await editTopic.getByRole("button", { name: "保存修改" }).click();
  await expect(editTopic).toHaveCount(0);
  await expect(inspector.getByRole("heading", { name: renamed })).toBeVisible();

  // Create, edit and retire a recall item.
  await page.getByRole("tab", { name: /掌握与图谱/ }).click();
  await page.getByRole("button", { name: "列表与掌握确认" }).click();
  await page.getByRole("button", { name: "新建主动回忆题" }).click();
  const quizSheet = page.getByRole("dialog", { name: "新建主动回忆题" });
  await quizSheet.getByLabel("关联知识点").selectOption({ label: renamed });
  await quizSheet.getByLabel("题目").fill("Original prompt");
  await quizSheet.getByLabel("参考答案").fill("Original answer");
  await quizSheet.getByRole("button", { name: "加密保存题目" }).click();
  await expect(quizSheet).toHaveCount(0);
  await expect(inspector.getByText("Original prompt")).toBeVisible();
  await inspector.getByRole("button", { name: "编辑", exact: true }).click();
  const editQuiz = page.getByRole("dialog", { name: "编辑回忆题" });
  // Synced items never carry the answer; empty keeps the original.
  await expect(editQuiz.getByLabel("参考答案")).toHaveValue("");
  await expect(editQuiz.getByLabel("参考答案")).toHaveAttribute(
    "placeholder",
    "本机没有保存原答案；留空保持不变",
  );
  await editQuiz.getByLabel("题目").fill("Corrected prompt");
  await editQuiz.getByRole("button", { name: "保存修改" }).click();
  await expect(editQuiz).toHaveCount(0);
  await expect(inspector.getByText("Corrected prompt")).toBeVisible();
  await inspector.getByRole("button", { name: "停用回忆题" }).click();
  const retire = page.getByRole("dialog", { name: "确认停用" });
  await retire.getByRole("button", { name: "确认停用" }).click();
  await expect(retire).toHaveCount(0);
  await expect(inspector.getByText("Corrected prompt")).toHaveCount(0);
  await expect(inspector.getByText("这个知识点还没有回忆题。")).toBeVisible();

  // Add and delete a prerequisite.
  await page.getByRole("button", { name: "添加先修依赖" }).click();
  const dependency = page.getByRole("dialog", { name: "添加先修依赖" });
  await dependency.getByLabel("先学知识点").selectOption({ label: first });
  await dependency.getByLabel("后学知识点").selectOption({ label: renamed });
  await dependency.getByRole("button", { name: "保存依赖" }).click();
  await expect(dependency).toHaveCount(0);
  await expect(inspector.getByText(`先修：${first}`)).toBeVisible();
  await inspector.getByRole("button", { name: "删除先修关系" }).click();
  const remove = page.getByRole("dialog", { name: "确认删除" });
  await remove.getByRole("button", { name: "确认删除" }).click();
  await expect(remove).toHaveCount(0);
  await expect(inspector.getByText(`先修：${first}`)).toHaveCount(0);

  // The server holds the corrections.
  const workspaces = (
    await (await page.request.get("/api/v1/workspaces")).json()
  ).workspaces as Array<{ id: string }>;
  let found = false;
  for (const workspace of workspaces) {
    const spaces = (
      await (
        await page.request.get(`/api/v1/workspaces/${workspace.id}/spaces`)
      ).json()
    ).spaces as Array<{ id: string }>;
    for (const space of spaces) {
      const base = `/api/v1/workspaces/${workspace.id}/spaces/${space.id}`;
      const topics = (await (await page.request.get(`${base}/topics`)).json())
        .topics as Array<{
        id: string;
        title: string;
      }>;
      const topic = topics.find((item) => item.title === renamed);
      if (!topic) continue;
      found = true;
      const quizzes = (
        await (await page.request.get(`${base}/quiz-items`)).json()
      ).quiz_items as Array<{ topic_id: string }>;
      expect(quizzes.filter((item) => item.topic_id === topic.id)).toHaveLength(
        0,
      );
    }
  }
  expect(found).toBe(true);
});
