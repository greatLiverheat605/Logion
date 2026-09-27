import { defineConfig, devices } from "@playwright/test";

import {
  configuredCredentials,
  e2eBaseUrl,
  shouldRunAuthenticated,
} from "./tests/browser/e2e-environment";

const publicTests =
  /(?:public-accessibility|public-flows-conformance|experience-confirm|pwa-offline)\.spec\.ts/;
const authenticatedTests =
  /(?:authenticated-accessibility|authenticated-shell|auth-public-flow|persona-system|prototype-productization|integration-hub|today-workbench|search-workbench|records-workbench|sync-workbench|planning-workbench|review-workbench|exam-workbench|self-study-workbench|research-workbench|collaboration-workbench|workspace-lifecycle|templates-workbench|feedback-visibility|status-copy-consistency|session-continuity|source-links|form-drafts|memory-corrections)\.spec\.ts/;

export default defineConfig({
  testDir: "./tests/browser",
  globalSetup: "./tests/browser/global-setup.ts",
  globalTeardown: "./tests/browser/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: configuredCredentials !== null ? 1 : process.env.CI ? 2 : 4,
  timeout: 30_000,
  expect: { timeout: 20_000 },
  outputDir: "reports/browser/artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "reports/browser/results.json" }],
    ["html", { outputFolder: "reports/browser/html", open: "never" }],
  ],
  use: {
    baseURL: e2eBaseUrl.origin,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  // Separate runtime flag instances prove both branches against the same build.
  webServer: [true, false].map((enabled) => ({
    command: `pnpm --filter @logion/web start --hostname 127.0.0.1 --port ${enabled ? 3080 : 3081}`,
    url: `http://127.0.0.1:${enabled ? 3080 : 3081}/health`,
    env: {
      LOGION_RESEARCH_V3_ENABLED: String(enabled),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    reuseExistingServer: false,
  })),
  projects: [
    {
      name: "workbench-chromium",
      testMatch: /research-foundation\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3080" },
    },
    {
      name: "public-chromium",
      testMatch: publicTests,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "public-firefox",
      testMatch: publicTests,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "public-webkit",
      testMatch: publicTests,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "public-mobile-chrome",
      testMatch: publicTests,
      use: { ...devices["Pixel 7"] },
    },
    {
      name: "public-mobile-safari",
      testMatch: publicTests,
      use: { ...devices["iPhone 15"] },
    },
    ...(shouldRunAuthenticated
      ? [
          {
            name: "authenticated-chromium",
            fullyParallel: false,
            testMatch: authenticatedTests,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
});
