import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const planningStyles = readFileSync(
  new URL("./planning-workbench.module.css", import.meta.url),
  "utf8",
);
const todayStyles = readFileSync(
  new URL("../execution/today-workbench.module.css", import.meta.url),
  "utf8",
);

describe("Today and Planning workbench height contract", () => {
  it("fills the authenticated content viewport below the topbar", () => {
    for (const styles of [todayStyles, planningStyles]) {
      expect(styles).toMatch(
        /\.root :global\(\.workbench-frame\) \{\s*min-height: calc\(100dvh - var\(--topbar-height\)\);/,
      );
      expect(styles).not.toContain("100dvh - 6.5rem");
      expect(styles).toMatch(
        /@media \(max-width: 719px\) \{\s*\.root :global\(\.workbench-frame\) \{\s*min-height: 0;/,
      );
    }
  });

  it("keeps mobile Today sync controls at touch target size", () => {
    expect(todayStyles).toContain(
      "  .iconButton {\n    width: 2.75rem;\n    min-width: 2.75rem;\n  }",
    );
  });
});
