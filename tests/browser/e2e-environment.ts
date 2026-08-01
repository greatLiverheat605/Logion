import { resolve } from "node:path";

export const e2eBaseUrl = new URL(
  process.env.LOGION_E2E_BASE_URL ?? "http://127.0.0.1:8080",
);
export const isLoopbackRealStack =
  ["127.0.0.1", "localhost"].includes(e2eBaseUrl.hostname) &&
  e2eBaseUrl.port === "8080";
export const configuredCredentials =
  process.env.LOGION_E2E_EMAIL && process.env.LOGION_E2E_PASSWORD
    ? {
        email: process.env.LOGION_E2E_EMAIL,
        password: process.env.LOGION_E2E_PASSWORD,
      }
    : null;
export const canProvisionAccounts =
  isLoopbackRealStack &&
  (process.env.LOGION_E2E_PROVISION_ACCOUNTS === "true" || !process.env.CI);
export const shouldRunAuthenticated =
  canProvisionAccounts || configuredCredentials !== null;
export const requiresAuthenticatedGate =
  process.env.LOGION_E2E_REQUIRE_AUTHENTICATED === "true";
export const authenticationStateDirectory = resolve("test-results", ".auth");
export const authenticationManifestPath = resolve(
  authenticationStateDirectory,
  "manifest.json",
);

if (requiresAuthenticatedGate && !shouldRunAuthenticated) {
  throw new Error(
    "The authenticated browser gate is required, but isolated provisioning or explicit credentials are unavailable.",
  );
}
