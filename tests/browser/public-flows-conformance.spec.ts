import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  auditHorizontalOverflow,
  WORKBENCH_VIEWPORTS,
} from "./workbench-audit";

const wcagTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const publicFlows = [
  {
    name: "invite",
    path: `/invitations/accept#token=${"a".repeat(40)}`,
    ready: async (page: Page) => {
      await expect(page.getByTestId("invite-summary")).toBeVisible();
      await expect(page.getByTestId("invite-action")).toBeVisible();
    },
  },
  {
    name: "share-invalid",
    path: `/shares/${"b".repeat(40)}`,
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "此分享不存在、已过期或已被撤销" }),
      ).toBeVisible();
    },
  },
  {
    name: "deletion-unauthenticated",
    path: "/account/deletion",
    ready: async (page: Page) => {
      await expect(
        page.getByRole("heading", { name: "无法读取删除状态" }),
      ).toBeVisible();
    },
  },
  {
    name: "offline",
    path: "/offline",
    ready: async (page: Page) => {
      await expect(page.getByTestId("offline-state")).toBeVisible();
      await expect(page.getByTestId("offline-recovery")).toBeVisible();
    },
  },
  {
    name: "not-found",
    path: "/public-flow-route-does-not-exist",
    ready: async (page: Page) => {
      await expect(page.getByTestId("not-found-state")).toBeVisible();
      await expect(page.getByTestId("not-found-recovery")).toBeVisible();
    },
  },
] as const;

type AuditPage = Page;

function screenshotPath(
  name: string,
  viewport: (typeof WORKBENCH_VIEWPORTS)[number],
) {
  return resolve(
    "reports",
    "ui-refactor",
    "after",
    `public-${name}-${viewport.label}.png`,
  );
}

async function capture(
  page: AuditPage,
  name: string,
  viewport: (typeof WORKBENCH_VIEWPORTS)[number],
) {
  const path = screenshotPath(name, viewport);
  await mkdir(dirname(path), { recursive: true });
  // Reduced-motion is already emulated for the audit. Playwright's `animations: "disabled"`
  // injects nonce-less style tags, which CSP correctly rejects in WebKit.
  await page.screenshot({ fullPage: false, path });
  const bytes = await page.screenshot({ fullPage: false });
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("public recovery flows preserve structure and accessibility at every product viewport", async ({
  page,
}, testInfo) => {
  const evidence: Array<Record<string, unknown>> = [];
  for (const viewport of WORKBENCH_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const flow of publicFlows) {
      const runtimeProblems: string[] = [];
      const onConsole = (message: { type(): string; text(): string }) => {
        const text = message.text();
        const expectedShareNotFound =
          flow.name === "share-invalid" && text.includes("status of 404");
        const expectedDeletionUnauthorized =
          flow.name === "deletion-unauthenticated" &&
          text.includes("status of 401");
        const expectedRouteNotFound =
          flow.name === "not-found" && text.includes("status of 404");
        const expectedFirefoxStrictDynamicWarning =
          testInfo.project.name === "public-firefox" &&
          message.type() === "warning" &&
          text.includes("Content-Security-Policy") &&
          text.includes("Ignoring") &&
          text.includes("strict-dynamic");
        if (
          ["error", "warning"].includes(message.type()) &&
          !expectedShareNotFound &&
          !expectedDeletionUnauthorized &&
          !expectedRouteNotFound &&
          !expectedFirefoxStrictDynamicWarning
        ) {
          runtimeProblems.push(`${message.type()}: ${text}`);
        }
      };
      page.on("console", onConsole);
      await page.goto(flow.path, { waitUntil: "domcontentloaded" });
      await flow.ready(page);

      const axe = await new AxeBuilder({ page }).withTags(wcagTags).analyze();
      expect(axe.violations, `${flow.name} ${viewport.label} Axe`).toEqual([]);

      const overflow = await auditHorizontalOverflow(page);
      expect(
        overflow.offenders,
        `${flow.name} ${viewport.label} overflow`,
      ).toEqual([]);
      expect(
        overflow.scrollWidth,
        `${flow.name} ${viewport.label} root overflow`,
      ).toBe(overflow.clientWidth);

      const primaryCount = await page
        .locator('[data-workbench-primary="true"]:visible')
        .count();
      expect(
        primaryCount,
        `${flow.name} ${viewport.label} primary count`,
      ).toBeLessThanOrEqual(1);

      const reducedMotion = await page.evaluate(
        () =>
          Array.from(document.body.querySelectorAll("*")).filter((element) => {
            const style = getComputedStyle(element);
            return (
              (style.animationName !== "none" &&
                style.animationDuration !== "0s") ||
              (style.transitionProperty !== "none" &&
                style.transitionDuration !== "0s")
            );
          }).length,
      );
      expect(
        reducedMotion,
        `${flow.name} ${viewport.label} reduced motion`,
      ).toBe(0);

      const interactive = page.locator("a,button,input");
      const interactiveCount = await interactive.count();
      expect(
        interactiveCount,
        `${flow.name} ${viewport.label} interactive controls`,
      ).toBeGreaterThan(0);
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          visible: rect.width > 0 && rect.height > 0,
        };
      });
      expect(
        focused,
        `${flow.name} ${viewport.label} keyboard focus`,
      ).toMatchObject({ visible: true });

      // WebKit's screenshot implementation injects a nonce-less `body {}` style while
      // synchronizing the capture. Keep application console diagnostics active outside
      // that test-harness-only window so CSP errors from the page remain actionable.
      page.off("console", onConsole);
      const screenshot = await capture(page, flow.name, viewport);
      page.on("console", onConsole);
      evidence.push({
        ...screenshot,
        flow: flow.name,
        viewport: viewport.label,
        runtimeProblems,
      });
      expect(
        runtimeProblems,
        `${flow.name} ${viewport.label} runtime console`,
      ).toEqual([]);
      page.off("console", onConsole);
    }
  }
  await writeFile(
    resolve("reports", "ui-refactor", "public-flows-browser-evidence.json"),
    JSON.stringify(evidence, null, 2),
    "utf8",
  );
});
