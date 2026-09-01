import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";
import { waitForWorkbenchReady, WORKBENCH_VIEWPORTS } from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const sampleRoutes = ["/app/today", "/app/search", "/app/records"] as const;

test("sample workbenches pass Axe at every product viewport", async ({
  page,
}) => {
  test.setTimeout(180_000);

  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const route of sampleRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await waitForWorkbenchReady(page, route);
      const results = await new AxeBuilder({ page })
        .withTags(wcagTags)
        .analyze();
      expect(
        results.violations,
        `${route} @ ${viewport.label} must have no automated WCAG violations`,
      ).toEqual([]);
    }
  }
});

test("persona selection and settings expose keyboard and ARIA state", async ({
  page,
}) => {
  await page.goto("/onboarding");
  const personaGroup = page.getByRole("group", { name: "用户画像" });
  const firstPersona = personaGroup.getByRole("button").first();
  await firstPersona.focus();
  await expect(firstPersona).toBeFocused();
  await expect(firstPersona).toHaveAttribute("aria-pressed", "false");
  const onboardingResults = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .analyze();
  expect(onboardingResults.violations).toEqual([]);

  await page.goto("/app/settings");
  const selectedPersona = page.locator('.persona-card[aria-pressed="true"]');
  await expect(selectedPersona).toHaveCount(1);
  const settingsResults = await new AxeBuilder({ page })
    .withTags(wcagTags)
    .analyze();
  expect(settingsResults.violations).toEqual([]);
});
