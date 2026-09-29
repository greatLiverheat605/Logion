import { defineConfig, devices } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";

const origin = "http://127.0.0.1:3090";
// API integration tests run before this suite; their rate-limit buckets are separate.
const researchRedis = new URL(
  process.env.LOGION_REDIS_URL ?? "redis://127.0.0.1:6379/0",
);
researchRedis.pathname = "/15";
const integrationKeyring = JSON.stringify({
  active: "test",
  keys: { test: randomBytes(32).toString("base64url") },
});
// Each launch has an ephemeral keyring; never reuse ciphertext from an older launch.
const attachmentRoot = `reports/research-real/attachments/${randomUUID()}`;

// Only this suite starts real research-enabled services. The regular browser
// configuration and integration tests keep their existing environments.
export default defineConfig({
  testDir: "./tests/browser",
  testMatch:
    /research-(real-backend|reading-loop|knowledge|online-planning|records|memory-review|settings|security|data|search|mobile-reading|legacy-data)\.spec\.ts/,
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
      command: `uv run --package logion-api python tests/fixtures/research_runtime.py api ${enabled ? 8000 : 8001}`,
      url: `http://127.0.0.1:${enabled ? 8000 : 8001}/health/live`,
      env: {
        LOGION_ENV: "test",
        LOGION_KNOWLEDGE_CURSOR_ACTIVE_KEY_ID: "test",
        LOGION_KNOWLEDGE_CURSOR_KEYS: JSON.stringify({
          test: randomBytes(32).toString("hex"),
        }),
        // Sixteen isolated accounts share this suite's one loopback proxy IP.
        LOGION_REGISTRATION_LIMIT_PER_HOUR: "16",
        LOGION_PLANNING_PHASE_REVISION_ENABLED: "true",
        LOGION_SOURCE_LINKS_ENABLED: "true",
        LOGION_REDIS_URL:
          process.env.LOGION_RESEARCH_TEST_REDIS_URL ??
          researchRedis.toString(),
        LOGION_ZOTERO_ORIGIN: "http://127.0.0.1:8192",
        LOGION_WEBDAV_ORIGIN: "http://127.0.0.1:8192",
        LOGION_INTEGRATION_KEYRING: integrationKeyring,
        LOGION_PDF_CACHE_KEYRING: integrationKeyring,
        LOGION_ATTACHMENT_ROOT: attachmentRoot,
        LOGION_RESEARCH_V3_ENABLED: String(enabled),
        LOGION_ALLOWED_ORIGINS: JSON.stringify([origin]),
        LOGION_WEBAUTHN_RP_ID: "127.0.0.1",
        LOGION_WEBAUTHN_ORIGINS: JSON.stringify([origin]),
      },
      reuseExistingServer: false,
    })),
    {
      command:
        "uv run --package logion-worker python -u tests/fixtures/research_runtime.py worker",
      wait: { stdout: /worker_started/ },
      env: {
        LOGION_ENV: "test",
        LOGION_RESEARCH_V3_ENABLED: "true",
        LOGION_ZOTERO_ORIGIN: "http://127.0.0.1:8192",
        LOGION_WEBDAV_ORIGIN: "http://127.0.0.1:8192",
        LOGION_INTEGRATION_KEYRING: integrationKeyring,
        LOGION_PDF_CACHE_KEYRING: integrationKeyring,
        LOGION_ATTACHMENT_ROOT: attachmentRoot,
        LOGION_REDIS_URL:
          process.env.LOGION_RESEARCH_TEST_REDIS_URL ??
          researchRedis.toString(),
        LOGION_WORKER_HEALTH_STATE_PATH:
          "reports/research-real/worker-health.json",
      },
    },
    {
      command:
        "pnpm --filter @logion/web start --hostname 127.0.0.1 --port 3090",
      url: `${origin}/health`,
      env: { LOGION_RESEARCH_V3_ENABLED: "true", NEXT_TELEMETRY_DISABLED: "1" },
      reuseExistingServer: false,
    },
  ],
});
