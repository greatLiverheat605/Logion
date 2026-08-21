import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

const maliciousName = '<img src=x onerror="alert(1)">';
const id = "123e4567-e89b-42d3-a456-426614174000";
const preference = {
  contract: "workbench.preference",
  payload: {
    activeWorkbenchId: "fixed.learning",
    defaultSpaceByWorkbench: {},
    defaultViewByWorkbench: {},
    density: "comfortable",
    hiddenFixedWorkbenchIds: [],
    workbenchOrder: [
      "fixed.learning",
      "fixed.research",
      "fixed.exam",
      "fixed.mentor",
      id,
    ],
  },
  revision: 1,
  schemaVersion: 1,
};
const summary = {
  accent: "cyan",
  createdAt: "2026-08-20T00:00:00Z",
  description: "安全文本",
  icon: "microscope",
  id,
  lifecycle: "active",
  name: maliciousName,
  ownerUserId: "223e4567-e89b-42d3-a456-426614174000",
  revision: 1,
  templateId: "fixed.research",
  updatedAt: "2026-08-20T00:00:00Z",
};

async function mockEnabledWorkbenches(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/users/me/workbenches?limit=50", (route) =>
    route.fulfill({
      body: JSON.stringify({ items: [summary], nextCursor: null }),
      contentType: "application/json",
      status: 200,
    }),
  );
  await page.route(
    "**/api/v1/users/me/settings?key=workbench.preference",
    (route) =>
      route.fulfill({
        body: JSON.stringify({
          settings: [
            {
              key: "workbench.preference",
              value: JSON.stringify(preference),
              version: 1,
            },
          ],
        }),
        contentType: "application/json",
        status: 200,
      }),
  );
}

test("enabled Workbench settings are responsive, keyboard reachable, axe-clean, and XSS-safe", async ({
  page,
}) => {
  await mockEnabledWorkbenches(page);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/app/settings");

  await expect(page.getByRole("heading", { name: "固定工作台" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "自定义工作台" }),
  ).toBeVisible();
  await expect(page.getByText(maliciousName, { exact: true })).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  const create = page.getByRole("button", { name: "新建工作台" });
  await create.focus();
  await expect(create).toBeFocused();
  await create.click();
  await expect(page.getByRole("dialog", { name: "新建工作台" })).toBeVisible();
  await page.keyboard.press("Escape");

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await page.setViewportSize({ height: 720, width: 320 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
