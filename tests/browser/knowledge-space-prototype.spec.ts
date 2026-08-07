import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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

    const node = page
      .locator(".ks-graph-svg-wrap")
      .getByRole("button", { name: "主动回忆 — 主题 — 已确认" });
    await expect(node).toBeVisible();
    await node.click();

    await expect(
      page.locator(".ks-inspector-title").getByText("主动回忆"),
    ).toBeVisible();
  });

  test("exposes the graph view from the real product review page", async ({
    page,
  }) => {
    await page.goto("/app/review#knowledge-graph");
    await expect(page.getByRole("button", { name: "图谱" })).toBeVisible();
    await page.getByRole("button", { name: "图谱" }).click();
    await expect(
      page.getByRole("heading", { name: "知识空间", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".ks-graph-svg-wrap, .ks-empty-canvas, .ks-state-panel"),
    ).toBeVisible();
  });

  test("keeps the prototype accessible and usable at desktop and mobile widths", async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto("/app/knowledge-prototype", {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: "知识空间", exact: true }),
      ).toBeVisible();

      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(
        dimensions.scrollWidth,
        `knowledge prototype must fit ${viewport.width}px`,
      ).toBeLessThanOrEqual(dimensions.clientWidth);

      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .analyze();
      expect(results.violations).toEqual([]);
    }

    await expect(
      page.getByRole("navigation", { name: "知识空间节点列表" }),
    ).toBeVisible();
  });

  test("supports graph keyboard navigation and rejects malicious persisted theme values", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "app-shell-theme",
        '<img src=x onerror="window.__knowledgeSpaceXssExecuted = true">',
      );
      (
        window as typeof window & { __knowledgeSpaceXssExecuted?: boolean }
      ).__knowledgeSpaceXssExecuted = false;
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app/knowledge-prototype", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      /^(light|dark)$/,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __knowledgeSpaceXssExecuted?: boolean;
              }
            ).__knowledgeSpaceXssExecuted,
        ),
      )
      .toBe(false);

    const nodes = page.locator("[data-node-id]");
    await expect(nodes.first()).toBeVisible();
    await nodes.first().focus();
    const firstNodeId = await nodes.first().getAttribute("data-node-id");
    const nextNodeId = await nodes.nth(1).getAttribute("data-node-id");
    expect(firstNodeId).not.toBeNull();
    expect(nextNodeId).not.toBeNull();
    expect(nextNodeId).not.toBe(firstNodeId);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(() => page.locator(":focus").getAttribute("data-node-id"))
      .toBe(nextNodeId);
    await page.keyboard.press("Escape");
    await expect(page.getByText("选择一个节点查看详情")).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".ks-inspector-title")).toBeVisible();
  });
});
