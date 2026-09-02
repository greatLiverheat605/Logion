import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workbenchStyles = readFileSync(
  new URL("./workbench.css", import.meta.url),
  "utf8",
);
const syncStyles = readFileSync(
  new URL("../../features/sync/sync-workbench.module.css", import.meta.url),
  "utf8",
);
const aiStyles = readFileSync(
  new URL(
    "../../features/ai/ai-governance-workbench.module.css",
    import.meta.url,
  ),
  "utf8",
);

describe("F-5 mobile touch targets", () => {
  it("raises sync actions to 44px without changing desktop icon geometry", () => {
    expect(workbenchStyles).toMatch(
      /@media \(max-width: 719px\) \{[\s\S]*?\.workbench-toolbar button\[aria-label="同步当前 Workspace"\][\s\S]*?min-width: 2\.75rem;[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(workbenchStyles).toMatch(
      /\.workbench-toolbar button\[aria-label="立即同步"\][\s\S]*?min-width: 2\.75rem;[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(syncStyles).toContain("min-height: 2.45rem;");
    expect(aiStyles).toContain("min-height: 2.2rem;");
  });

  it("raises custom drawer navigation rows on mobile", () => {
    expect(syncStyles).toMatch(
      /@media \(max-width: 719px\) \{[\s\S]*?\.masterNav button[\s\S]*?min-height: 2\.75rem;/,
    );
    expect(aiStyles).toMatch(
      /@media \(max-width: 720px\) \{[\s\S]*?\.masterNav button[\s\S]*?min-height: 2\.75rem;/,
    );
  });
});
