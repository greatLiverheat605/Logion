import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const globalStyles = readFileSync(
  new URL("../../app/globals.css", import.meta.url),
  "utf8",
);
const workbenchStyles = readFileSync(
  new URL("./workbench.css", import.meta.url),
  "utf8",
);
const appShellSource = readFileSync(
  new URL("../app-shell/app-shell.tsx", import.meta.url),
  "utf8",
);

function contrastRatio(foreground: string, background: string) {
  const luminance = (value: string) => {
    const channels = value
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16) / 255)
      .map((channel) =>
        channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
    return (
      0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
    );
  };
  const values = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  );
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

function themeTokens(selector: string) {
  const block = globalStyles.match(
    new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  if (!block) throw new Error(`Missing theme block: ${selector}`);
  return new Map(
    Array.from(block.matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gi), (match) => [
      match[1],
      match[2],
    ]),
  );
}

describe("GLM shared visual contract", () => {
  it("freezes the approved light and dark token values", () => {
    for (const token of [
      "--bg: #f5f6f8",
      "--surface: #ffffff",
      "--surface-2: #f0f2f5",
      "--surface-3: #e7eaef",
      "--border: #dfe3ea",
      "--text: #1f2733",
      "--text-3: #535e69",
      "--accent: #3056d3",
      "--bg: #0e1116",
      "--surface: #151a21",
      "--surface-2: #1b222b",
      "--surface-3: #232c37",
      "--border: #29323e",
      "--text: #e5eaf1",
      "--text-3: #8794a3",
      "--accent: #4a75e0",
    ]) {
      expect(globalStyles).toContain(token);
    }
    expect(globalStyles).toContain("--radius-sm: 0.25rem");
    expect(globalStyles).toContain("--radius-md: 0.375rem");
    expect(globalStyles).toContain("--radius-lg: 0.625rem");
  });

  it("keeps tertiary text readable on every light and dark surface", () => {
    for (const [selector, theme] of [
      [':root,\\s*:root\\[data-theme="light"\\]', "light"],
      [':root\\[data-theme="dark"\\]', "dark"],
    ] as const) {
      const tokens = themeTokens(selector);
      const text = tokens.get("text-3")!;
      for (const surface of ["surface", "surface-2", "surface-3"] as const) {
        const background = tokens.get(surface)!;
        expect(
          contrastRatio(text, background),
          `${theme} --text-3 on --${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("uses the approved Shell geometry and a quiet page background", () => {
    expect(globalStyles).toContain("--sidebar-width: 14.5rem");
    expect(globalStyles).toContain("--topbar-height: 3rem");
    expect(globalStyles).toMatch(
      /\.app-topbar \{[\s\S]*?height: var\(--topbar-height\);/,
    );
    expect(globalStyles).toMatch(
      /\.app-content \{[\s\S]*?flex: 1;[\s\S]*?overflow: auto;/,
    );
    const bodyRule = globalStyles.match(/body \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(bodyRule).toContain("background: var(--bg)");
    expect(bodyRule).not.toContain("radial-gradient");
    expect(globalStyles).toMatch(/body::before \{\s*content: none;/);
  });

  it("freezes Workbench geometry and responsive ownership", () => {
    expect(globalStyles).toContain("--workbench-master-width: 16.5rem");
    expect(globalStyles).toContain("--workbench-inspector-width: 19.75rem");
    expect(workbenchStyles).toContain(
      "var(--workbench-master-width)\n    minmax(0, 1fr)\n    var(--workbench-inspector-width)",
    );
    expect(workbenchStyles).toContain("@media (max-width: 1099px)");
    expect(workbenchStyles).toContain("@media (max-width: 719px)");
    expect(workbenchStyles).toContain(
      '"master main"\n      "master inspector"',
    );
  });

  it("exposes stable Shell regions without changing application context logic", () => {
    expect(appShellSource).toContain('data-testid="app-sidebar"');
    expect(appShellSource).toContain('data-testid="app-topbar"');
    expect(appShellSource).toContain('data-testid="app-main"');
    expect(appShellSource).toContain("notificationState.workspaceName");
    expect(appShellSource).toContain("notificationState.workspaceRole");
  });

  it("keeps mobile drawer navigation links at touch target size", () => {
    expect(globalStyles).toMatch(
      /@media \(max-width: 45rem\) \{[\s\S]*?\.app-nav-link \{[\s\S]*?min-height: 2\.75rem;/,
    );
  });
});
