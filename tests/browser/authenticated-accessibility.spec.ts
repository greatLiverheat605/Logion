import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./fixtures";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

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
