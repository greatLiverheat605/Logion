import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const selectors = [
  ["ai/ai-workbench-page.tsx", "ai-mode"],
  ["ai/run-center.tsx", "ai-drafts"],
  ["ai/run-center.tsx", "ai-source"],
  ["ai/run-center.tsx", "ai-review"],
  ["ai/provider-center.tsx", "ai-provider"],
  ["ai/run-center.tsx", "ai-runs"],
  ["integrations/integration-hub.tsx", "integrations-summary"],
  ["integrations/integration-hub.tsx", "integrations-calendar"],
  ["integrations/integration-hub.tsx", "integrations-open-format"],
  ["integrations/integration-hub.tsx", "integrations-deferred"],
  ["audit/audit-log.tsx", "audit-filters"],
  ["audit/audit-log.tsx", "audit-event-detail"],
] as const;

describe("frozen route selectors", () => {
  it("keeps the approved AI, integrations, and audit testids in stable views", () => {
    for (const [viewPath, testId] of selectors) {
      const source = readFileSync(
        new URL(`./${viewPath}`, import.meta.url),
        "utf8",
      );
      expect(source, `${viewPath} should expose ${testId}`).toContain(
        `data-testid="${testId}"`,
      );
    }
  });
});
