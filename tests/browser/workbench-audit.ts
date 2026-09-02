import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

export const WORKBENCH_VIEWPORTS = [
  { height: 640, label: "320x640", width: 320 },
  { height: 844, label: "390x844", width: 390 },
  { height: 768, label: "1024x768", width: 1024 },
  { height: 900, label: "1440x900", width: 1440 },
] as const;

export type WorkbenchViewport = (typeof WORKBENCH_VIEWPORTS)[number];

interface ElementDiagnostic {
  clientWidth: number;
  overflowX: string;
  rect: { left: number; right: number; width: number };
  scrollWidth: number;
  selector: string;
}

interface HorizontalOverflowAudit {
  clientWidth: number;
  offenders: ElementDiagnostic[];
  scrollWidth: number;
}

function auditLabel(route: string, viewport: WorkbenchViewport) {
  return `${route} @ ${viewport.label}`;
}

export async function waitForWorkbenchReady(page: Page, route: string) {
  await page.waitForLoadState("domcontentloaded");
  await expect(
    page.locator(".app-shell-frame"),
    `${route} must render the authenticated App Shell`,
  ).toBeVisible();
  await expect(
    page.locator("h1").first(),
    `${route} must expose a visible page heading`,
  ).toBeVisible();
}

export async function auditHorizontalOverflow(
  page: Page,
): Promise<HorizontalOverflowAudit> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const classes = Array.from(element.classList)
        .slice(0, 2)
        .map((value) => `.${CSS.escape(value)}`)
        .join("");
      return `${element.tagName.toLowerCase()}${classes}`;
    };
    const offenders = Array.from(document.body.querySelectorAll("*"))
      .flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0
        ) {
          return [];
        }
        const extendsViewport =
          rect.left < viewportWidth && rect.right > viewportWidth + 1;
        const scrollsHorizontally =
          element.scrollWidth > element.clientWidth + 1 &&
          !["clip", "hidden"].includes(style.overflowX);
        if (!extendsViewport && !scrollsHorizontally) return [];
        return [
          {
            clientWidth: element.clientWidth,
            overflowX: style.overflowX,
            rect: {
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              width: Math.round(rect.width),
            },
            scrollWidth: element.scrollWidth,
            selector: selectorFor(element),
          },
        ];
      })
      .slice(0, 8);

    return {
      clientWidth: root.clientWidth,
      offenders,
      scrollWidth: root.scrollWidth,
    };
  });
}

export async function assertNoHorizontalOverflow(
  page: Page,
  route: string,
  viewport: WorkbenchViewport,
) {
  const audit = await auditHorizontalOverflow(page);
  expect(
    audit.scrollWidth,
    `${auditLabel(route, viewport)} horizontal overflow: ${JSON.stringify(audit)}`,
  ).toBeLessThanOrEqual(audit.clientWidth);
  expect(
    audit.offenders,
    `${auditLabel(route, viewport)} contains horizontally overflowing elements: ${JSON.stringify(audit.offenders)}`,
  ).toEqual([]);
}

export async function assertWorkbenchViewportFill(
  page: Page,
  route: string,
  viewport: WorkbenchViewport,
) {
  if (viewport.width < 720) return;
  const diagnostic = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>(
      '[data-testid="app-main"]',
    );
    const frame = document.querySelector<HTMLElement>(
      '[data-testid="workbench-frame"]',
    );
    if (!main || !frame) return null;
    const mainRect = main.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    return {
      mainBottom: Math.round(mainRect.bottom),
      frameBottom: Math.round(frameRect.bottom),
      gap: Math.round(mainRect.bottom - frameRect.bottom),
    };
  });
  expect(
    diagnostic,
    `${auditLabel(route, viewport)} must expose app-main and workbench-frame geometry`,
  ).not.toBeNull();
  expect(
    diagnostic!.gap,
    `${auditLabel(route, viewport)} leaves a bottom gap below the workbench: ${JSON.stringify(diagnostic)}`,
  ).toBeLessThanOrEqual(1);
}

export async function assertPrimaryActionContract(
  page: Page,
  route: string,
  viewport: WorkbenchViewport,
) {
  const primaries = page.locator('[data-workbench-primary="true"]:visible');
  const count = await primaries.count();
  expect(
    count,
    `${auditLabel(route, viewport)} exposes ${count} visible primary actions`,
  ).toBeLessThanOrEqual(1);
  if (count === 0) return;

  const primary = primaries.first();
  const diagnostic = await primary.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = element.matches("a,button,input")
      ? element
      : element.querySelector("a,button,input");
    return {
      hasInteractiveTarget: target !== null,
      rect: {
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
      },
      text: element.textContent?.trim().slice(0, 120) ?? "",
      viewport: { height: innerHeight, width: innerWidth },
    };
  });
  expect(
    diagnostic.hasInteractiveTarget,
    `${auditLabel(route, viewport)} primary has no interactive target: ${JSON.stringify(diagnostic)}`,
  ).toBe(true);
  expect(
    diagnostic.rect.right > 0 &&
      diagnostic.rect.left < diagnostic.viewport.width &&
      diagnostic.rect.bottom > 0 &&
      diagnostic.rect.top < diagnostic.viewport.height,
    `${auditLabel(route, viewport)} primary is outside the viewport: ${JSON.stringify(diagnostic)}`,
  ).toBe(true);
}

export async function auditReducedMotion(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) => {
    const durationMs = (value: string) =>
      Math.max(
        ...value.split(",").map((part) => {
          const duration = part.trim();
          if (duration.endsWith("ms")) return Number.parseFloat(duration);
          if (duration.endsWith("s")) return Number.parseFloat(duration) * 1000;
          return 0;
        }),
      );
    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      return `${element.tagName.toLowerCase()}${Array.from(element.classList)
        .slice(0, 2)
        .map((value) => `.${CSS.escape(value)}`)
        .join("")}`;
    };

    return elements
      .flatMap((element) => {
        const style = getComputedStyle(element);
        const animationMs = durationMs(style.animationDuration);
        const transitionMs = durationMs(style.transitionDuration);
        const isMoving =
          (style.animationName !== "none" && animationMs > 1) ||
          (style.transitionProperty !== "none" && transitionMs > 1);
        return isMoving
          ? [
              {
                animation: `${style.animationName} ${style.animationDuration}`,
                selector: selectorFor(element),
                transition: `${style.transitionProperty} ${style.transitionDuration}`,
              },
            ]
          : [];
      })
      .slice(0, 8);
  });
}

export async function assertReducedMotion(
  page: Page,
  route: string,
  viewport: WorkbenchViewport,
) {
  const moving = await auditReducedMotion(page, ".app-shell-frame *");
  expect(
    moving,
    `${auditLabel(route, viewport)} does not honor reduced motion: ${JSON.stringify(moving)}`,
  ).toEqual([]);
}

export function evidenceScreenshotPath(
  phase: "after" | "before",
  route: string,
  viewport: WorkbenchViewport,
) {
  const slug = route.replace(/^\//, "").replaceAll("/", "-") || "root";
  return resolve(
    "reports",
    "ui-refactor",
    phase,
    `${slug}-${viewport.label}.png`,
  );
}

export async function captureEvidenceScreenshot(
  page: Page,
  phase: "after" | "before",
  route: string,
  viewport: WorkbenchViewport,
) {
  const path = evidenceScreenshotPath(phase, route, viewport);
  await mkdir(dirname(path), { recursive: true });
  await page.screenshot({ animations: "disabled", fullPage: false, path });
  return path;
}
