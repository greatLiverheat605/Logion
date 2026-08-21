import { defineConfig, devices } from "@playwright/test";

import {
  authenticatedWorkerCount,
  configuredCredentials,
  e2eBaseUrl,
  shouldRunAuthenticated,
} from "./tests/browser/e2e-environment";

const publicTests = /(?:public-accessibility|pwa-offline)\.spec\.ts/;
const authenticatedTests =
  /(?:authenticated-accessibility|authenticated-shell|persona-system|workbench-system|prototype-productization|integration-hub|knowledge-space-prototype)\.spec\.ts/;

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
  projects: [
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
            workers: authenticatedWorkerCount,
            testMatch: authenticatedTests,
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
});
