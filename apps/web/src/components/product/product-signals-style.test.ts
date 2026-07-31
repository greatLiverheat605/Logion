import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const signalStyles = readFileSync(
  new URL("./product-signals.css", import.meta.url),
  "utf8",
);

describe("product signal styles", () => {
  it("uses shared semantic tokens instead of a competing palette", () => {
    expect(signalStyles).toContain("var(--bg-muted)");
    expect(signalStyles).toContain("var(--border)");
    expect(signalStyles).toContain("var(--muted)");
    expect(signalStyles).toContain("var(--cyan)");
    expect(signalStyles).not.toMatch(/#[\da-f]{3,8}\b/i);
    expect(signalStyles).not.toContain("filter: invert");
  });
});
