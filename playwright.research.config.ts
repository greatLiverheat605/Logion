import { defineConfig, devices } from "@playwright/test";
import { randomBytes } from "node:crypto";

const origin = "http://127.0.0.1:3090";
// API integration tests run before this suite; their rate-limit buckets are separate.
const researchRedis = new URL(
  process.env.LOGION_REDIS_URL ?? "redis://127.0.0.1:6379/0",
);
researchRedis.pathname = "/15";

// Only this suite starts real research-enabled services. The regular browser
// configuration and integration tests keep their existing environments.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch: /research-real-backend\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 20_000 },
  outputDir: "reports/research-real/artifacts",
  reporter: [
    ["line"],
    ["json", { outputFile: "reports/research-real/results.json" }],
    ["html", { outputFolder: "reports/research-real/html", open: "never" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: origin,
    locale: "zh-CN",
    // Real session cookies and synthetic credentials must not enter artifacts.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "uv run --package logion-api python tests/fixtures/research_services.py",
      url: "http://127.0.0.1:8192/health",
      reuseExistingServer: false,
    },
    ...[true, false].map((enabled) => ({
      command: `uv run --package logion-api uvicorn logion_api.main:app --host 127.0.0.1 --port ${enabled ? 8000 : 8001} --no-access-log`,
      url: `http://127.0.0.1:${enabled ? 8000 : 8001}/health/live`,
      env: {
        LOGION_ENV: "test",
        LOGION_REDIS_URL:
          process.env.LOGION_RESEARCH_TEST_REDIS_URL ??
          researchRedis.toString(),
        LOGION_ZOTERO_ORIGIN: "http://127.0.0.1:8192",
        LOGION_WEBDAV_ORIGIN: "http://127.0.0.1:8192",
        LOGION_INTEGRATION_KEYRING: JSON.stringify({
          active: "test",
          keys: { test: randomBytes(32).toString("base64url") },
        }),
        LOGION_RESEARCH_V3_ENABLED: String(enabled),
        LOGION_ALLOWED_ORIGINS: JSON.stringify([origin]),
        LOGION_WEBAUTHN_RP_ID: "127.0.0.1",
        LOGION_WEBAUTHN_ORIGINS: JSON.stringify([origin]),
      },
      reuseExistingServer: false,
    })),
    {
      command:
        "pnpm --filter @logion/web start --hostname 127.0.0.1 --port 3090",
      url: `${origin}/health`,
      env: { LOGION_RESEARCH_V3_ENABLED: "true", NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
    },
  ],
});
