import { expect, test } from "./fixtures";

test.describe("knowledge space prototype", () => {
  test("renders the interactive graph and exposes node details", async ({
    page,
  }) => {
    await page.goto("/app/knowledge-prototype");
    await expect(page.getByRole("heading", { name: "知识空间" })).toBeVisible();
    await expect(
      page.getByLabel("知识图谱：可用方向键导航节点，Enter 选择，Esc 取消选择"),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "原型状态演示" }),
    ).toBeVisible();

    const node = page.getByRole("button", { name: /主动回忆/ });
    await expect(node).toBeVisible();
    await node.click();

    await expect(
      page.locator(".ks-inspector-title").getByText("主动回忆"),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "审批操作（本地模拟）" }),
    ).toBeVisible();
  });

  test("exposes the graph view from the real product review page", async ({
    page,
  }) => {
    await page.goto("/app/review#knowledge-graph");
    await expect(page.getByRole("button", { name: "图谱" })).toBeVisible();
    await page.getByRole("button", { name: "图谱" }).click();
    await expect(page.getByRole("heading", { name: "知识空间" })).toBeVisible();
    await expect(
      page.locator(".ks-graph-svg-wrap, .ks-empty-canvas, .ks-state-panel"),
    ).toBeVisible();
  });
});
