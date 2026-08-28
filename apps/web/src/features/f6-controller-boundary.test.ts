import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const views = [
  ["memory/review-center.tsx", "memory/use-review-controller.ts"],
  ["exam/exam-center.tsx", "exam/use-exam-controller.ts"],
  [
    "self-study/self-study-center.tsx",
    "self-study/use-self-study-controller.ts",
  ],
  ["security/security-center.tsx", "security/use-security-controller.ts"],
  ["sync/offline-sync-center.tsx", "sync/use-sync-controller.ts"],
  ["ai/provider-center.tsx", "ai/use-provider-controller.ts"],
  ["ai/run-center.tsx", "ai/use-ai-run-controller.ts"],
  ["audit/audit-log.tsx", "audit/use-audit-controller.ts"],
] as const;

describe("F-6 controller boundary", () => {
  it("keeps browser API access in route controllers", () => {
    for (const [viewPath, controllerPath] of views) {
      const view = readFileSync(
        new URL(`./${viewPath}`, import.meta.url),
        "utf8",
      );
      const controllerUrl = new URL(`./${controllerPath}`, import.meta.url);
      expect(existsSync(controllerUrl), controllerPath).toBe(true);
      const controller = readFileSync(controllerUrl, "utf8");

      expect(view, viewPath).not.toContain("browserApiClient");
      expect(controller, controllerPath).toContain("browserApiClient");
      expect(controller, controllerPath).toMatch(
        /export function use[A-Z].*Controller/,
      );
    }
  });
});
